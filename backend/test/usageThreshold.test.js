import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BYTES_PER_GB,
  billableUsageBytes,
  billableUsageFilter,
  billableUsageGb,
  exactBillableUsageGb,
  sumBillableUsageBytes,
} from '../src/utils/usageThreshold.js';

test('usage is billable only when a path is strictly above 1 GB', () => {
  assert.equal(billableUsageBytes(BYTES_PER_GB - 1n), 0n);
  assert.equal(billableUsageBytes(BYTES_PER_GB), 0n);
  assert.equal(billableUsageBytes(BYTES_PER_GB + 1n), BYTES_PER_GB + 1n);
});

test('display conversion applies the threshold before rounding', () => {
  assert.equal(billableUsageGb(BYTES_PER_GB - 1n), 0);
  assert.equal(billableUsageGb(BYTES_PER_GB), 0);
  assert.equal(billableUsageGb(BYTES_PER_GB + 1n), 2);
  assert.equal(exactBillableUsageGb(2n * BYTES_PER_GB), 2);
});

test('aggregation applies the threshold to each path before summing', () => {
  const values = [BYTES_PER_GB - 1n, BYTES_PER_GB, 2n * BYTES_PER_GB];
  assert.equal(sumBillableUsageBytes(values), 2n * BYTES_PER_GB);
  assert.deepEqual(billableUsageFilter(), { gt: BYTES_PER_GB });
});

test('aggregate display rounds once after summing retained path bytes', () => {
  const values = [BYTES_PER_GB + 1n, BYTES_PER_GB + 1n];
  const totalBytes = sumBillableUsageBytes(values);
  assert.equal(totalBytes, 2n * BYTES_PER_GB + 2n);
  assert.equal(billableUsageGb(totalBytes), 3);
});

test('stale preview bytes are normalized again at the commit boundary', () => {
  assert.equal(billableUsageBytes(String(BYTES_PER_GB - 1n)), 0n);
  assert.equal(billableUsageBytes(String(BYTES_PER_GB)), 0n);
  assert.equal(billableUsageBytes(String(BYTES_PER_GB + 1n)), BYTES_PER_GB + 1n);
});
