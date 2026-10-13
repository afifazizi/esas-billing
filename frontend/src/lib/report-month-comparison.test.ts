import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deltaTone,
  formatCount,
  formatDeltaGb,
  formatDeltaPct,
  formatRevenueRm,
  formatSignedCount,
  formatTotalUsage,
  monthLongLabel,
  monthShortLabel,
  normalizeCustomerOptions,
  normalizeYearlyComparison,
  pickLatestYear,
} from './report-month-comparison.ts';

const monthRow = (month: number, overrides: Record<string, unknown> = {}) => ({
  year: 2026,
  month,
  usageBytes: '0',
  usageGb: 0,
  fileCount: 0,
  reportRows: 0,
  revenue: 0,
  deltaUsageBytes: null,
  deltaUsageGb: null,
  deltaUsagePct: null,
  deltaFileCount: null,
  deltaReportRows: null,
  previousPeriod: null,
  ...overrides,
});

test('normalizeYearlyComparison maps the covenant payload onto typed rows without raw unknown fields', () => {
  const payload = {
    customer: { custId: 'mp', name: 'Media Prima' },
    selectedYear: 2026,
    availableYears: [2026, 2025],
    totals: {
      usageBytes: '3221225472',
      usageGb: 3,
      fileCount: 30,
      reportRows: 3,
      totalRevenue: 42.5,
    },
    months: [
      monthRow(1, { usageBytes: '1073741824', usageGb: 1, fileCount: 10, reportRows: 1, revenue: 12.5, previousPeriod: null }),
      monthRow(2, {
        usageBytes: '2147483648', usageGb: 2, fileCount: 20, reportRows: 2, revenue: 30,
        deltaUsageBytes: '1073741824', deltaUsageGb: 1, deltaUsagePct: 100,
        deltaFileCount: 10, deltaReportRows: 1,
        previousPeriod: { year: 2026, month: 1 },
      }),
    ],
  };

  const summary = normalizeYearlyComparison(payload, 2026);

  assert.equal(summary.customerId, 'mp');
  assert.equal(summary.customerName, 'Media Prima');
  assert.equal(summary.year, 2026);
  assert.deepEqual(summary.availableYears, [2026, 2025]);
  assert.equal(summary.months.length, 12);
  assert.equal(summary.totals.usageBytes, '3221225472');
  assert.equal(summary.totals.usageGb, 3);
  assert.equal(summary.totals.fileCount, 30);
  assert.equal(summary.totals.reportRows, 3);
  assert.equal(summary.totals.totalRevenue, 42.5);

  const january = summary.months[0];
  assert.equal(january.label, 'January');
  assert.equal(january.usageGb, 1);
  assert.equal(january.revenue, 12.5);
  assert.equal(january.deltaUsageGb, null);
  assert.equal(january.previousPeriod, null);

  const february = summary.months[1];
  assert.equal(february.label, 'February');
  assert.equal(february.usageGb, 2);
  assert.equal(february.deltaUsageGb, 1);
  assert.equal(february.deltaUsagePct, 100);
  assert.equal(february.deltaFileCount, 10);
  assert.equal(february.deltaReportRows, 1);
  assert.deepEqual(february.previousPeriod, { year: 2026, month: 1 });

  // March..December keep honest zero rows, not undefined.
  for (const month of summary.months.slice(2)) {
    assert.equal(month.usageGb, 0);
    assert.equal(month.fileCount, 0);
    assert.equal(month.reportRows, 0);
    assert.equal(month.revenue, 0);
    assert.equal(month.deltaUsageGb, null);
    assert.equal(month.previousPeriod, null);
  }
});

test('empty months after data keep zeros with honest negative deltas', () => {
  const payload = {
    customer: { custId: 'jpj', name: 'JPJ' },
    selectedYear: 2026,
    availableYears: [2026],
    totals: { usageBytes: '1073741824', usageGb: 1, fileCount: 5, reportRows: 1 },
    months: [
      monthRow(1, { usageBytes: '1073741824', usageGb: 1, fileCount: 5, reportRows: 1, revenue: 4.5 }),
      monthRow(2, {
        usageBytes: '0', usageGb: 0, fileCount: 0, reportRows: 0, revenue: 0,
        deltaUsageBytes: '-1073741824', deltaUsageGb: -1, deltaUsagePct: -100,
        deltaFileCount: -5, deltaReportRows: -1,
        previousPeriod: { year: 2026, month: 1 },
      }),
    ],
  };

  const summary = normalizeYearlyComparison(payload, 2026);
  const february = summary.months[1];
  assert.equal(february.usageGb, 0);
  assert.equal(february.deltaUsageGb, -1);
  assert.equal(february.deltaUsagePct, -100);
  assert.equal(february.deltaFileCount, -5);
  assert.equal(february.deltaReportRows, -1);
  // Totals missing totalRevenue fall back to the sum of month revenue.
  assert.equal(summary.totals.totalRevenue, 4.5);
});

test('January keeps null deltas even when the backend sends no delta fields at all', () => {
  const summary = normalizeYearlyComparison({
    customer: { custId: 'mp', name: 'Media Prima' },
    selectedYear: 2026,
    availableYears: [2026],
    totals: { usageBytes: '0', usageGb: 0, fileCount: 0, reportRows: 0 },
    months: [{ year: 2026, month: 1, usageBytes: '1073741824', usageGb: 1, fileCount: 7, reportRows: 1 }],
  }, 2026);

  assert.equal(summary.months.length, 12);
  const january = summary.months[0];
  assert.equal(january.usageGb, 1);
  assert.equal(january.fileCount, 7);
  assert.equal(january.deltaUsageGb, null);
  assert.equal(january.deltaUsagePct, null);
  assert.equal(january.deltaFileCount, null);
  assert.equal(january.previousPeriod, null);
  // Months 2..12 zero-filled.
  assert.equal(summary.months[11].label, 'December');
  assert.equal(summary.months[11].usageGb, 0);
});

test('malformed payloads collapse to honest zeros instead of crashing', () => {
  for (const payload of [null, undefined, 'oops', 42, [], {}, { months: 'nope' }, { customer: 'x' }]) {
    const summary = normalizeYearlyComparison(payload, 2026);
    assert.equal(summary.months.length, 12);
    assert.equal(summary.customerName, '');
    assert.equal(summary.year, 2026);
    assert.equal(summary.totals.usageGb, 0);
    assert.equal(summary.months[0].label, 'January');
    assert.equal(summary.months[11].usageGb, 0);
  }
});

test('usageGb falls back to usageBytes / 1 GiB when the GB field is missing', () => {
  const summary = normalizeYearlyComparison({
    customer: { custId: 'a', name: 'A' },
    selectedYear: 2026,
    availableYears: [2026],
    months: [{ year: 2026, month: 6, usageBytes: '3221225472', fileCount: 2, reportRows: 2 }],
  }, 2026);

  assert.equal(summary.months[5].usageGb, 3);
});

test('availableYears are deduplicated and sorted newest first', () => {
  const summary = normalizeYearlyComparison({
    customer: { custId: 'a', name: 'A' },
    selectedYear: 2024,
    availableYears: [2024, 2026, 2024, 2025],
    months: [],
  }, 2024);

  assert.deepEqual(summary.availableYears, [2026, 2025, 2024]);
});

test('pickLatestYear prefers the newest year with data and falls back to the request year', () => {
  assert.equal(pickLatestYear([2023, 2026, 2024], 2026), 2026);
  assert.equal(pickLatestYear([], 2026), 2026);
  assert.equal(pickLatestYear(['2025', 'not-a-year'], 2026), 2025);
});

test('normalizeCustomerOptions maps { id, name } rows and drops unusable entries', () => {
  const options = normalizeCustomerOptions([
    { id: 'mp', name: 'Media Prima', price: 0.12, departmentCount: 4 },
    { id: 'jpj', name: '  JPJ  ' },
    { id: '', name: 'Ghost' },
    { name: 'No Id' },
    'garbage',
  ]);
  assert.deepEqual(options, [
    { id: 'jpj', name: 'JPJ' },
    { id: 'mp', name: 'Media Prima' },
  ]);
  assert.deepEqual(normalizeCustomerOptions(null), []);
  assert.deepEqual(normalizeCustomerOptions({ data: [] }), []);
});

test('delta formatters render null as a muted dash and signed values otherwise', () => {
  assert.equal(formatDeltaGb(null), '—');
  assert.equal(formatDeltaGb(1.25), '+1.3 GB');
  assert.equal(formatDeltaGb(-1), '-1.0 GB');
  assert.equal(formatDeltaPct(null), '—');
  assert.equal(formatDeltaPct(12.34), '+12.3%');
  assert.equal(formatDeltaPct(-7.25), '-7.3%');
  assert.equal(formatSignedCount(null), '—');
  assert.equal(formatSignedCount(1200), '+1,200');
  assert.equal(formatSignedCount(-1200), '-1,200');
});

test('delta tone classifies null, positive, negative, and flat values', () => {
  assert.equal(deltaTone(null), 'none');
  assert.equal(deltaTone(5), 'up');
  assert.equal(deltaTone(-5), 'down');
  assert.equal(deltaTone(0), 'flat');
});

test('revenue and usage formatters match dashboard conventions', () => {
  assert.equal(formatRevenueRm(1234.5), 'RM 1,234.50');
  assert.equal(formatRevenueRm(0), 'RM 0.00');
  assert.equal(formatTotalUsage(512), '512 GB');
  assert.equal(formatTotalUsage(2048), '2.0 TB');
  assert.equal(formatTotalUsage(1572864), '1.50 PB');
  assert.equal(formatCount(1500), '1,500');
});

test('month labels map 1..12 and reject out-of-range months', () => {
  assert.equal(monthLongLabel(1), 'January');
  assert.equal(monthLongLabel(12), 'December');
  assert.equal(monthShortLabel(9), 'Sep');
  assert.equal(monthLongLabel(0), '—');
  assert.equal(monthLongLabel(13), '—');
  assert.equal(monthShortLabel(13), '—');
});
