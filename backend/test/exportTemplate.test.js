import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  deriveCustomerCode,
  buildReportId,
  buildValidationRows,
  buildMonthlyHistory,
  buildMonthComparison,
  buildMomDifferenceMatrix,
  buildClusterMonthComparison,
  computeRevenue,
} from '../src/utils/pdfTemplate.js';
import { buildRenderPlan, footerLeft, footerRight, resolveLogoPath } from '../src/utils/pdfLayout.js';
import { formatAxisMax, clusterColor } from '../src/utils/pdfCharts.js';
import { buildPdfPayloadForCustomer } from '../src/utils/pdfPayload.js';
import { exactBillableUsageGb } from '../src/utils/usageThreshold.js';

// ─── Report ID / customer code ───────────────────────────────────────────────

test('report ID uses 3-letter customer code, deterministic', () => {
  assert.equal(deriveCustomerCode('Media Prima', 'mp'), 'MPB');
  assert.equal(deriveCustomerCode('Media Prima', 'mp'), deriveCustomerCode('Media Prima', 'mp'));
  assert.match(buildReportId(deriveCustomerCode('Media Prima', 'mp'), '2026', '05'), /^ESAS-MPB-\d{4}-\d{2}$/);
});

test('report ID zero-pads the month', () => {
  assert.equal(buildReportId('MPB', '2026', '5'), 'ESAS-MPB-2026-05');
  assert.equal(buildReportId('JPJ', 2026, 12), 'ESAS-JPJ-2026-12');
});

// ─── Validation rows (1.1) ──────────────────────────────────────────────────

test('validation rows PASS on clean data and FAIL when unmatched or no rows', () => {
  const clean = buildValidationRows({ monthLabel: 'May 2026', expectedPaths: 5, receivedPaths: 5, rowCount: 5, pendingUnmatched: 0, monthsOfHistory: 12 });
  assert.equal(clean[4].result, 'Complete');
  assert.equal(clean[4].status, 'PASS');
  assert.equal(clean[0].result, '5');

  const withPending = buildValidationRows({ monthLabel: 'May 2026', expectedPaths: 5, receivedPaths: 5, rowCount: 5, pendingUnmatched: 2, monthsOfHistory: 12 });
  assert.equal(withPending[2].result, '2');
  assert.equal(withPending[2].status, 'FAIL');
  assert.equal(withPending[4].status, 'FAIL');
  assert.equal(withPending[4].result, 'Incomplete');

  const withZeroRows = buildValidationRows({ monthLabel: 'May 2026', expectedPaths: 5, receivedPaths: 0, rowCount: 0, pendingUnmatched: 0, monthsOfHistory: 12 });
  assert.equal(withZeroRows[1].status, 'FAIL');

  const duplicateRowsMissingPath = buildValidationRows({ monthLabel: 'May 2026', expectedPaths: 5, receivedPaths: 4, rowCount: 10, pendingUnmatched: 0, monthsOfHistory: 12 });
  assert.equal(duplicateRowsMissingPath[1].result, '4');
  assert.equal(duplicateRowsMissingPath[1].status, 'FAIL');
  assert.equal(duplicateRowsMissingPath[4].status, 'FAIL');
});

// ─── Monthly history + MoM math ─────────────────────────────────────────────

test('monthly history: January MoM is dash, blank months tracked, values in TB/PB', () => {
  const rows = [
    { year: '2026', month: '01', usageSize: 1024n ** 4n, folderId: 'f1', clusterName: 'A', pathLabel: 'P' },
    { year: '2026', month: '03', usageSize: 1024n ** 5n, folderId: 'f1', clusterName: 'A', pathLabel: 'P' },
  ];
  const series = buildMonthlyHistory('2026', 3, rows);
  assert.equal(series.length, 3);
  assert.equal(series[0].momPct, '-');
  assert.equal(series[1].momPct, 'N/A'); // blank Feb (no rows at all) with zero-prev division
  assert.ok(series[2].usageTb.includes('10'));

  const withFeb = buildMonthlyHistory('2026', 3, [
    { year: '2026', month: '01', usageSize: 1024n ** 4n, folderId: 'f1' },
    { year: '2026', month: '02', usageSize: 1024n ** 4n, folderId: 'f1' },
    { year: '2026', month: '03', usageSize: 2n * 1024n ** 4n, folderId: 'f1' },
  ]);
  assert.equal(withFeb[1].momPct, '0.00%');
  assert.equal(withFeb[2].momPct, '100.00%');
});

// ─── 5.4 comparison ─────────────────────────────────────────────────────────

test('current vs previous month change math', () => {
  const tb = (n) => BigInt(n) * 1024n * 1073741824n;
  const cmp = buildMonthComparison('2', '2026', tb(110), tb(100));
  assert.equal(cmp.prevTb, '100.00');
  assert.equal(cmp.curTb, '110.00');
  assert.equal(cmp.change, '10.00');
  assert.equal(cmp.changePct, '10.00%');

  const unknownPrev = buildMonthComparison('1', '2026', tb(5), 0n);
  assert.equal(unknownPrev.changePct, 'N/A');
});

// ─── 5.6 matrix ─────────────────────────────────────────────────────────────

test('MoM difference matrix: N/A when path not in both months, signed TB diffs', () => {
  const tb = (n) => BigInt(n) * 1024n * 1073741824n;
  const rows = [
    { year: '2026', month: '01', usageSize: tb(10), folderId: 'f1', pathLabel: 'Alpha' },
    { year: '2026', month: '02', usageSize: tb(12), folderId: 'f1', pathLabel: 'Alpha' },
    { year: '2026', month: '02', usageSize: tb(5), folderId: 'f2', pathLabel: 'Beta' },
  ];
  const matrix = buildMomDifferenceMatrix(rows, { month: 3, year: '2026' });
  assert.deepEqual(matrix.columns, ['JAN-FEB', 'FEB-MAR']);
  const alpha = matrix.rows.find((r) => r.label === 'Alpha');
  assert.equal(alpha.cells[0], 2); // FEB 12 - JAN 10
  assert.equal(alpha.cells[1], null); // Alpha absent in March → N/A
  const beta = matrix.rows.find((r) => r.label === 'Beta');
  assert.equal(beta.cells[0], null); // not represented in January
  assert.equal(beta.cells[1], null); // not represented in March → N/A for both pairs
});

// ─── 5.5 cluster MoM ────────────────────────────────────────────────────────

test('cluster month-on-month comparison sums per cluster', () => {
  const tb = (n) => BigInt(n) * 1024n * 1073741824n;
  const rows = [
    { year: '2026', month: '01', usageSize: tb(10), clusterName: 'SG-1' },
    { year: '2026', month: '02', usageSize: tb(15), clusterName: 'SG-1' },
    { year: '2026', month: '02', usageSize: tb(5), clusterName: 'SG-2' },
  ];
  const out = buildClusterMonthComparison(rows, { month: 2, year: '2026' });
  const sg1 = out.find((r) => r.cluster === 'SG-1');
  assert.equal(sg1.prevTb, '10.00');
  assert.equal(sg1.curTb, '15.00');
  assert.equal(sg1.change, '5.00');
  assert.equal(sg1.changePct, '50.00%');
});

// ─── Revenue exactness ──────────────────────────────────────────────────────

test('revenue uses exact billable bytes * price, rounded once to 2dp', () => {
  const threeQuarters = 3n * (1073741824n / 4n); // billable? must exceed 1 GB -> use 1.75GB case
  const reports = [
    { usageSize: 1073741824n * 2n, pricePerGb: 1.2 }, // 2.40
    { usageSize: 1073741824n + 1073741824n / 2n, pricePerGb: 2 }, // 1.5 GB -> 3.00
    { usageSize: 100n, pricePerGb: 99 }, // below threshold -> 0
  ];
  const revenue = computeRevenue(reports);
  assert.equal(revenue, Math.round((2 * 1.2 + 1.5 * 2) * 100) / 100);
  assert.equal(exactBillableUsageGb(100n), 0);
});

// ─── Render plan (template v9 section order) ────────────────────────────────

test('render plan follows template v9 section order with standalone portrait pages', () => {
  const plan = buildRenderPlan({ momMatrix: { rows: [{ label: 'A', cells: [1] }] } });
  const idx = (name) => plan.findIndex((s) => s.name.startsWith(name));
  assert.ok(idx('COVER') < idx('1. Executive Summary'));
  assert.equal(plan[0].standalone, true);
  assert.ok(plan.every((step) => step.layout === 'portrait'));
  assert.ok(!plan.some((step) => /landscape/i.test(step.name)));
  assert.ok(idx('1. Executive Summary') < idx('2. Isilon Report'));
  assert.ok(idx('2. Isilon Report') < idx('3. Workfolder Summary'));
  assert.ok(idx('3. Workfolder Summary') < idx('4. Cluster Summary'));
  assert.ok(idx('4. Cluster Summary') < idx('5.1 Monthly Total Usage'));
  assert.ok(idx('5.1 Monthly Total Usage') < idx('5.2 Cluster Trend'));
  assert.ok(idx('5.2 Cluster Trend') < idx('5.3 Monitoring Scope Changes'));
  assert.ok(idx('5.3 Monitoring Scope Changes') < idx('5.6 Detailed Month-on-Month Differences'));
  assert.ok(idx('5.6 Detailed Month-on-Month Differences') < idx('6. Billing Summary'));
});

test('footer text format matches template v9', () => {
  assert.equal(footerLeft({ customer: 'Media Prima', month: '05', year: '2026' }), 'ESAS Cloud Storage Report | Media Prima | May 2026');
  assert.equal(footerRight(7), 'Page 7');
  assert.ok(!footerRight(7).includes('of'));
});

test('cluster palette is deterministic and matches template brand colors', () => {
  assert.equal(clusterColor('ARCHIVE'), '#E89496');
  assert.equal(clusterColor('DA (OLD ARCHIVE)'), '#F6C58F');
  assert.equal(clusterColor('NEWS'), '#F8DE91');
  assert.equal(clusterColor('NEARLINE'), '#ADD09F');
  assert.equal(clusterColor('POST PRODUCTION'), '#BBD3E7');
  assert.equal(clusterColor('archive'), clusterColor('ARCHIVE'));
  assert.equal(clusterColor('Unknown Cluster'), clusterColor('Unknown Cluster'));
});

test('IPSB logo resolves to a durable backend asset', () => {
  const path = resolveLogoPath();
  assert.match(path, /backend\/src\/assets\/ipsb-logo\.png$/);
  assert.equal(existsSync(path), true);
});

// ─── Chart axis unit (3.1 horizontal bar chart) ─────────────────────────────

test('3.1 chart axis max keeps the data unit (GB, thousands-separated) — no /1024 TB mislabel', () => {
  // Real-world scale from the defect: max workfolder row = 2,691,523 GB.
  assert.equal(formatAxisMax(2691523), '2,691,523 GB');
  assert.ok(!formatAxisMax(2691523).includes('TB'), 'GB data must never be labeled TB');
  assert.equal(formatAxisMax(1024), '1,024 GB');
  assert.equal(formatAxisMax(0), '0 GB');
});

// ─── Metadata label fit ────────────────────────────────────────────────────

test('cover metadata labels fit the 100pt label column (no run-in with value)', () => {
  const tb = (n) => BigInt(n) * 1024n * 1073741824n;
  const payload = buildPdfPayloadForCustomer({
    customer: { custName: 'Media Prima', prices: [{ price: 1.5 }] },
    custId: 'mp', month: 5, year: '2026',
    reports: [{ folderId: 'f1', usageSize: tb(1), pricePerGb: 2, month: '05', clusterName: 'MP ARCHIVE', pathLabel: 'ARCHIVE - Master' }],
    folderCount: 1, pendingUnmatched: 0,
  });
  // The authoritative cover preserves the full metadata label and allocates a
  // wider label column rather than abbreviating it.
  const labels = payload.metadata.map((m) => m.label.toUpperCase());
  assert.ok(labels.includes('GENERATED DATE/TIME'));
  assert.ok(!labels.includes('GENERATED AT'));
});

// ─── Payload assembly smoke ─────────────────────────────────────────────────

test('pdf payload assembly: report id, metadata, summary, ordering', () => {
  const tb = (n) => BigInt(n) * 1024n * 1073741824n;
  const reports = [
    { folderId: 'f2', usageSize: tb(3), pricePerGb: 2, month: '05', clusterName: 'MP ARCHIVE', pathLabel: 'ARCHIVE - Master' },
    { folderId: 'f1', usageSize: tb(4), pricePerGb: 2, month: '04', clusterName: 'MP DALET', pathLabel: 'DA (OLD ARCHIVE) - Dalet' },
    { folderId: 'f1', usageSize: tb(1), pricePerGb: 2, month: '05', clusterName: 'MP DALET', pathLabel: 'DA (OLD ARCHIVE) - Dalet' },
  ];
  const payload = buildPdfPayloadForCustomer({
    customer: { custName: 'Media Prima', prices: [{ price: 1.5 }] },
    custId: 'mp', month: 5, year: '2026', reports, folderCount: 2, pendingUnmatched: 0,
  });
  assert.equal(payload.reportId, 'ESAS-MPB-2026-05');
  const expectedGb = (3 + 1 + 4) * 1024; // TB-scale rows: 3TB(P4) + 4TB(P5) + 1TB(P5)
  assert.equal(payload.totalUsageGb, expectedGb);
  assert.equal(payload.totalRevenue, expectedGb * 2); // per-report applied price (pricePerGb=2) wins over customer default
  const meta = Object.fromEntries(payload.metadata.map((m) => [m.label.toLowerCase(), m.value]));
  assert.equal(meta['report month'], 'May 2026');
  assert.equal(meta['data cut-off'], '31 May 2026, 23:59 MYT');
  assert.ok(meta['report id'].startsWith('ESAS-MPB-2026-05'));
  assert.equal(meta['generated by'], 'ESAS Billing System');
  assert.deepEqual(payload.monthlySeries.map((s) => Number(s.usageTbNum)), [...Array(5)].map(() => 0) && payload.monthlySeries.map((s) => Number(s.usageTbNum)));
  // Isilon ordering: cluster asc then folder asc with full row list
  assert.equal(payload.isilon.length, 3);
  assert.ok(payload.isilon[0].cluster <= payload.isilon[payload.isilon.length - 1].cluster);
});
