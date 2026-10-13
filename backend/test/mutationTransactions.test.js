import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitUploadPreviewTransaction,
  repriceReportsTransaction,
  softDeleteReportTransaction,
} from '../src/services/reportMutations.js';
import { ignoreUnmatchedDirectoryTransaction, mapUnmatchedDirectoryTransaction } from '../src/services/unmatchedMutations.js';

function transactionalDb(tx, attempts = { count: 0 }) {
  return {
    async $transaction(operation, options) {
      attempts.count += 1;
      assert.deepEqual(options, { isolationLevel: 'Serializable' });
      return operation(tx);
    },
  };
}

test('upload confirm checks lifecycle in the serializable transaction before report writes', async () => {
  const calls = [];
  const tx = {
    reportPeriod: { findUnique: async () => { calls.push('guard'); return { status: 'DRAFT' }; } },
    report: {
      findFirst: async () => { calls.push('duplicate'); return null; },
      create: async () => { calls.push('report-write'); return { id: 'r1' }; },
    },
    importRun: { create: async () => { calls.push('import-write'); return { id: 'i1' }; } },
    unmatchedDirectory: { create: async () => { calls.push('unmatched-write'); } },
    auditLog: { create: async () => { calls.push('audit-write'); } },
  };
  await commitUploadPreviewTransaction(transactionalDb(tx), {
    preview: { custId: 'C1', month: '07', year: '2026', fileHash: 'h', fileName: 'x.csv', matchedCount: 1, unmatchedCount: 0, matchedRows: [{ folderId: 'f1', sizeBytes: '2147483648', pricePerGb: 2, dirCount: 0, fileCount: 1, adsCount: 0, otherCount: 0, directoryPath: '/x' }] },
    actor: { id: 'u1' },
  });
  assert.ok(calls.indexOf('guard') < calls.indexOf('report-write'));
  assert.ok(calls.indexOf('guard') < calls.indexOf('import-write'));
});

test('repricing and single deletion check lifecycle before writes in serializable transactions', async () => {
  const repriceCalls = [];
  const repriceTx = {
    reportPeriod: { findUnique: async () => { repriceCalls.push('guard'); return { status: 'DRAFT' }; } },
    price: { findUnique: async () => ({ id: 'p1', custId: 'C1', price: 3, label: 'Tier' }) },
    report: { updateMany: async () => { repriceCalls.push('write'); return { count: 2 }; } },
    auditLog: { create: async () => { repriceCalls.push('audit'); } },
  };
  await repriceReportsTransaction(transactionalDb(repriceTx), { custId: 'C1', month: '07', year: '2026', priceId: 'p1', actor: { id: 'u1' } });
  assert.deepEqual(repriceCalls.slice(0, 2), ['guard', 'write']);

  const deleteCalls = [];
  const deleteTx = {
    report: {
      findUnique: async () => ({ id: 'r1', custId: 'C1', month: '07', year: '2026', deletedAt: null }),
      update: async () => { deleteCalls.push('write'); return { id: 'r1' }; },
    },
    reportPeriod: { findUnique: async () => { deleteCalls.push('guard'); return { status: 'DRAFT' }; } },
    auditLog: { create: async () => { deleteCalls.push('audit'); } },
  };
  await softDeleteReportTransaction(transactionalDb(deleteTx), { reportId: 'r1', actor: { id: 'u1' } });
  assert.deepEqual(deleteCalls.slice(0, 2), ['guard', 'write']);
});

test('unmatched map and ignore guard lifecycle before readiness-changing writes', async () => {
  const baseDir = { id: 'd1', importRunId: 'i1', directoryPath: '/x', sizeBytes: 2147483648n, fileCount: 1, importRun: { id: 'i1', custId: 'C1', month: '07', year: '2026', fileHash: 'h', fileName: 'x.csv', unmatchedCount: 1, status: 'PARTIAL' } };
  const folder = { folderId: 'f1', department: { custId: 'C1', customer: { prices: [{ id: 'p1', price: 2, isDefault: true }] } } };
  const calls = [];
  const tx = {
    unmatchedDirectory: {
      findUnique: async () => baseDir,
      update: async () => { calls.push('unmatched-write'); return { ...baseDir, status: 'RESOLVED' }; },
    },
    folder: { findUnique: async () => folder },
    reportPeriod: { findUnique: async () => { calls.push('guard'); return { status: 'DRAFT' }; } },
    report: { findFirst: async () => null, create: async () => { calls.push('report-write'); return { id: 'r1' }; } },
    importRun: { update: async () => { calls.push('import-write'); } },
    auditLog: { create: async () => { calls.push('audit'); } },
  };
  await mapUnmatchedDirectoryTransaction(transactionalDb(tx), { directoryId: 'd1', folderId: 'f1', actor: { id: 'u1' } });
  assert.ok(calls.indexOf('guard') < calls.indexOf('report-write'));
  assert.ok(calls.indexOf('guard') < calls.indexOf('unmatched-write'));

  calls.length = 0;
  tx.unmatchedDirectory.update = async () => { calls.push('ignore-write'); return { ...baseDir, status: 'IGNORED' }; };
  await ignoreUnmatchedDirectoryTransaction(transactionalDb(tx), { directoryId: 'd1', actor: { id: 'u1' } });
  assert.deepEqual(calls.slice(0, 2), ['guard', 'ignore-write']);
});
