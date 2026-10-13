import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertPeriodMutable, planTransition } from '../src/services/reportLifecycle.js';

test('additive migration and lifecycle history work on a copied SQLite database', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esas-phase-a-'));
  const copiedDb = path.join(tempDir, 'dev-copy.db');
  await fs.copyFile(path.resolve('prisma/dev.db'), copiedDb);
  const db = new PrismaClient({ datasources: { db: { url: `file:${copiedDb}` } } });
  t.after(async () => {
    await db.$disconnect();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // The source database may already have Phase A applied. Remove only the
  // lifecycle tables from this disposable copy so the migration is repeatable.
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "report_period_transition"');
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "report_period"');
  const reportsBefore = await db.report.count();
  const sql = await fs.readFile(path.resolve('prisma/migrations/20260714000000_add_report_period_lifecycle/migration.sql'), 'utf8');
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
  assert.equal(await db.report.count(), reportsBefore, 'migration must preserve every existing report row');

  const [customer, admin] = await Promise.all([
    db.customer.findFirst({ where: { deletedAt: null } }),
    db.user.findFirst({ where: { userRole: 'admin' } }),
  ]);
  assert.ok(customer && admin, 'copied baseline needs an active customer and admin');

  const reviewed = planTransition(null, 'REVIEWED', { id: admin.id, role: 'admin' }, null, new Date('2026-07-14T00:00:00Z'));
  const period = await db.reportPeriod.create({
    data: { custId: customer.custId, month: '12', year: '2099', ...reviewed },
  });
  await db.reportPeriodTransition.create({
    data: { reportPeriodId: period.id, fromStatus: 'DRAFT', toStatus: 'REVIEWED', version: 1, actorId: admin.id },
  });
  const approved = await db.reportPeriod.update({
    where: { id: period.id },
    data: planTransition(period, 'APPROVED', { id: admin.id, role: 'admin' }),
  });
  await db.reportPeriodTransition.create({
    data: { reportPeriodId: period.id, fromStatus: 'REVIEWED', toStatus: 'APPROVED', version: 1, actorId: admin.id },
  });

  await assert.rejects(() => assertPeriodMutable(db, { custId: customer.custId, month: '12', year: '2099' }), (error) => error.status === 409);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(await db.reportPeriodTransition.count({ where: { reportPeriodId: period.id } }), 2);
});
