import test from 'node:test';
import assert from 'node:assert/strict';
import { softDeleteReports, validateBulkDeleteInput } from '../src/services/reportDeletion.js';

const reports = [
  { id: 'r1', custId: 'mp', month: '06', year: '2023' },
  { id: 'r2', custId: 'mp', month: '06', year: '2023' },
];

function fakeDatabase({ rows = reports, period = null, updateCount = rows.length } = {}) {
  const calls = { updates: [], audits: [], transactionOptions: [] };
  const tx = {
    report: {
      findMany: async () => rows,
      updateMany: async (args) => {
        calls.updates.push(args);
        return { count: updateCount };
      },
    },
    reportPeriod: {
      findUnique: async () => period,
    },
    auditLog: {
      create: async (args) => {
        calls.audits.push(args);
        return args.data;
      },
    },
  };
  return {
    calls,
    $transaction: async (operation, options) => {
      calls.transactionOptions.push(options);
      return operation(tx);
    },
  };
}

const input = {
  reportIds: ['r1', 'r2'],
  custId: 'mp',
  month: '06',
  year: '2023',
  actorId: 'admin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  now: new Date('2026-08-03T09:00:00.000Z'),
};

test('validates, normalizes, and bounds the bulk-delete request contract', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(validateBulkDeleteInput({
    reportIds: [first, second, first],
    custId: ' mp ',
    month: '6',
    year: '2023',
  }), {
    reportIds: [first, second],
    custId: 'mp',
    month: '06',
    year: '2023',
  });
  assert.throws(() => validateBulkDeleteInput({ reportIds: [], custId: 'mp', month: '06', year: '2023' }), (error) => error.status === 400);
  assert.throws(() => validateBulkDeleteInput({ reportIds: ['not-a-uuid'], custId: 'mp', month: '06', year: '2023' }), (error) => error.status === 400);
  assert.throws(() => validateBulkDeleteInput({ reportIds: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), custId: 'mp', month: '06', year: '2023' }), (error) => error.status === 400);
  assert.throws(() => validateBulkDeleteInput(null), (error) => error.status === 400);
});

test('bulk deletion soft-deletes one exact report period and writes one audit event', async () => {
  const db = fakeDatabase();
  const result = await softDeleteReports(db, input);

  assert.deepEqual(result, { deleted: 2, reportIds: ['r1', 'r2'] });
  assert.deepEqual(db.calls.transactionOptions, [{ isolationLevel: 'Serializable' }]);
  assert.equal(db.calls.updates.length, 1);
  assert.deepEqual(db.calls.updates[0].data, { deletedAt: input.now });
  assert.equal(db.calls.audits.length, 1);
  assert.equal(db.calls.audits[0].data.action, 'BULK_DELETE_REPORTS');
  assert.equal(db.calls.audits[0].data.entityId, 'mp:2023-06');
  assert.deepEqual(JSON.parse(db.calls.audits[0].data.newValue), {
    custId: 'mp',
    month: '06',
    year: '2023',
    deletedCount: 2,
    reportIds: ['r1', 'r2'],
  });
});

test('bulk deletion rejects missing or cross-period rows before mutation', async () => {
  for (const rows of [
    [reports[0]],
    [reports[0], { ...reports[1], month: '07' }],
  ]) {
    const db = fakeDatabase({ rows });
    await assert.rejects(() => softDeleteReports(db, input), (error) => error.status === 409);
    assert.equal(db.calls.updates.length, 0);
    assert.equal(db.calls.audits.length, 0);
  }
});

test('bulk deletion rejects approved or locked periods before mutation', async () => {
  for (const status of ['APPROVED', 'LOCKED']) {
    const db = fakeDatabase({ period: { id: 'period-1', status } });
    await assert.rejects(() => softDeleteReports(db, input), (error) => error.status === 409 && error.message.includes(status));
    assert.equal(db.calls.updates.length, 0);
    assert.equal(db.calls.audits.length, 0);
  }
});

test('bulk deletion rolls back when the final update count changes', async () => {
  const db = fakeDatabase({ updateCount: 1 });
  await assert.rejects(() => softDeleteReports(db, input), (error) => error.status === 409);
  assert.equal(db.calls.audits.length, 0);
});
