import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMutablePeriod,
  assertPeriodReadyForTransition,
  normalizePeriod,
  planTransition,
  validateTransitionInput,
} from '../src/services/reportLifecycle.js';

test('normalizes valid month/year and rejects bad periods', () => {
  assert.deepEqual(normalizePeriod({ custId: ' C1 ', month: '7', year: '2026' }), { custId: 'C1', month: '07', year: '2026' });
  assert.throws(() => normalizePeriod({ custId: '', month: '13', year: '26' }), (error) => error.status === 400);
});

test('internal users can submit draft for review', () => {
  const plan = planTransition({ status: 'DRAFT', version: 1 }, 'REVIEWED', { id: 'u1', role: 'user' }, null, new Date('2026-07-01T00:00:00Z'));
  assert.equal(plan.status, 'REVIEWED');
  assert.equal(plan.reviewedById, 'u1');
  assert.equal(plan.version, 1);
});

test('only admins can approve, lock, or reopen', () => {
  assert.throws(() => planTransition({ status: 'REVIEWED', version: 1 }, 'APPROVED', { id: 'u1', role: 'user' }), (error) => error.status === 403);
  assert.equal(planTransition({ status: 'REVIEWED', version: 1 }, 'APPROVED', { id: 'a1', role: 'admin' }).status, 'APPROVED');
  assert.equal(planTransition({ status: 'APPROVED', version: 1 }, 'LOCKED', { id: 'a1', role: 'admin' }).status, 'LOCKED');
});

test('reopen requires reason, returns to draft, clears downstream approvals and increments version', () => {
  assert.throws(() => planTransition({ status: 'LOCKED', version: 2 }, 'DRAFT', { id: 'a1', role: 'admin' }), (error) => error.status === 400);
  const plan = planTransition({ status: 'LOCKED', version: 2 }, 'DRAFT', { id: 'a1', role: 'admin' }, 'Correct source file');
  assert.equal(plan.status, 'DRAFT');
  assert.equal(plan.version, 3);
  assert.equal(plan.reopenReason, 'Correct source file');
  assert.equal(plan.approvedById, null);
  assert.equal(plan.lockedById, null);
});

test('invalid lifecycle transitions conflict', () => {
  assert.throws(() => planTransition({ status: 'DRAFT', version: 1 }, 'LOCKED', { id: 'a1', role: 'admin' }), (error) => error.status === 409);
  assert.throws(() => planTransition({ status: 'LOCKED', version: 1 }, 'APPROVED', { id: 'a1', role: 'admin' }), (error) => error.status === 409);
});

test('approved and locked periods reject report mutations', () => {
  assert.doesNotThrow(() => assertMutablePeriod(null));
  assert.doesNotThrow(() => assertMutablePeriod({ status: 'DRAFT' }));
  assert.doesNotThrow(() => assertMutablePeriod({ status: 'REVIEWED' }));
  for (const status of ['APPROVED', 'LOCKED']) {
    assert.throws(() => assertMutablePeriod({ status }), (error) => error.status === 409 && error.message.includes(status));
  }
});

test('transition input validates target and reopen reason', () => {
  assert.deepEqual(validateTransitionInput({ status: 'reviewed' }), { targetStatus: 'REVIEWED', reason: null });
  assert.throws(() => validateTransitionInput({ status: 'unknown' }), (error) => error.status === 400);
});

function readinessDb({ folders = ['f1', 'f2'], reports = [], pending = 0, latestImport = { status: 'SUCCESS' }, prices = [{ id: 'p1', price: 2, isDefault: true }] } = {}) {
  return {
    folder: { findMany: async () => folders.map((folderId) => ({ folderId })) },
    report: { findMany: async () => reports },
    unmatchedDirectory: { count: async () => pending },
    importRun: { findFirst: async () => latestImport },
    price: { findMany: async () => prices },
  };
}

test('approval and lock readiness rejects incomplete configured folder coverage inside the database boundary', async () => {
  const db = readinessDb({ reports: [{ folderId: 'f1', priceId: 'p1', pricePerGb: 2 }] });
  await assert.rejects(
    () => assertPeriodReadyForTransition(db, { custId: 'C1', month: '07', year: '2026' }, 'APPROVED'),
    (error) => error.status === 409 && error.message.includes('missing configured folder'),
  );
});

test('approval readiness rejects unmatched blockers, invalid prices, and failed or partial imports', async () => {
  const completeReports = [
    { folderId: 'f1', priceId: 'p1', pricePerGb: 2 },
    { folderId: 'f2', priceId: 'p1', pricePerGb: 2 },
  ];
  await assert.rejects(() => assertPeriodReadyForTransition(readinessDb({ reports: completeReports, pending: 1 }), { custId: 'C1', month: '07', year: '2026' }, 'APPROVED'), /unmatched/i);
  await assert.rejects(() => assertPeriodReadyForTransition(readinessDb({ reports: completeReports.map((row) => ({ ...row, priceId: null, pricePerGb: 0 })) }), { custId: 'C1', month: '07', year: '2026' }, 'APPROVED'), /price/i);
  await assert.rejects(() => assertPeriodReadyForTransition(readinessDb({ reports: completeReports, latestImport: { status: 'PARTIAL' } }), { custId: 'C1', month: '07', year: '2026' }, 'APPROVED'), /PARTIAL/);
  await assert.doesNotReject(() => assertPeriodReadyForTransition(readinessDb({ reports: completeReports }), { custId: 'C1', month: '07', year: '2026' }, 'LOCKED'));
});
