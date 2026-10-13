import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingCustomerSummary } from '../src/services/billingSummary.js';

test('billing summary includes missing-report customers and readiness issues', () => {
  const result = buildBillingCustomerSummary({
    customer: { custId: 'C1', custName: 'Customer', prices: [] },
    reports: [], period: null, imports: [], pendingUnmatched: 0, month: '07', year: '2026',
  });
  assert.equal(result.lifecycleStatus, 'DRAFT');
  assert.equal(result.reportRowCount, 0);
  assert.deepEqual(result.readiness.issues.map((issue) => issue.code), ['MISSING_REPORT', 'MISSING_PRICE']);
  assert.equal(result.readiness.readyForReview, false);
});

test('billing revenue uses each report applied price after the per-path 1 GB threshold', () => {
  const result = buildBillingCustomerSummary({
    customer: { custId: 'C1', custName: 'Customer', prices: [{ id: 'p1', price: 2, isDefault: true }] },
    reports: [
      { usageSize: 2147483648n, pricePerGb: 2, priceId: 'p1' },
      { usageSize: 1073741824n, pricePerGb: 99, priceId: null },
      { usageSize: 536870912n, pricePerGb: 99, priceId: null },
    ],
    period: { status: 'REVIEWED', version: 1 }, imports: [{ id: 'i1', status: 'SUCCESS' }], pendingUnmatched: 0, month: '07', year: '2026',
  });
  assert.equal(result.usageBytes, '2147483648');
  assert.equal(result.usageGb, 2);
  assert.equal(result.revenue, 4);
  assert.equal(result.readiness.readyForApproval, true);
});

test('dated applicable price wins over an unbounded default price', () => {
  const result = buildBillingCustomerSummary({
    customer: { custId: 'C1', custName: 'Customer', prices: [
      { id: 'default', price: 1, isDefault: true, effectiveFrom: null, effectiveTo: null },
      { id: 'dated', price: 3, isDefault: false, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2026-12-31T23:59:59Z') },
    ] },
    reports: [{ usageSize: 2147483648n, pricePerGb: 3, priceId: 'dated' }],
    period: { status: 'DRAFT', version: 1 }, imports: [{ status: 'SUCCESS' }], pendingUnmatched: 0, month: '07', year: '2026',
  });
  assert.equal(result.priceInfo.current.id, 'dated');
  assert.equal(result.priceInfo.default.id, 'default');
});
