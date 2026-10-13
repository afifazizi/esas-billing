import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerYearlyMonths, presentCustomerYearlySummary } from '../src/services/customerYearlySummary.js';

const BYTES_PER_GB = 1073741824n;

function monthRow(month, { usageBytes = 0n, fileCount = 0, reportRows = 0 } = {}) {
  return {
    month,
    _sum: { usageSize: usageBytes, fileCount },
    _count: { _all: reportRows },
  };
}

function billableRow(month, usageBytes) {
  return { month, _sum: { usageSize: usageBytes } };
}

// Reports below the 1 GB per-path threshold contribute 0 billable bytes and 0
// revenue; reports above it contribute their full size.
function report(month, gb, pricePerGb, { fileCount = 1 } = {}) {
  return {
    month,
    usageSize: BigInt(gb) * BYTES_PER_GB,
    fileCount,
    pricePerGb,
    folderId: 'f1',
    folder: { folderName: 'F1', department: { deptName: 'D1' } },
  };
}

test('January has null deltas and null previousPeriod', () => {
  const { months, totals } = buildCustomerYearlyMonths({
    year: '2026',
    monthlyRows: [monthRow('01', { usageBytes: 3n * BYTES_PER_GB, fileCount: 4, reportRows: 2 })],
    billableMonthlyRows: [billableRow('01', 3n * BYTES_PER_GB)],
    reports: [report('01', 2, 10), report('01', 1, 5)],
  });

  const january = months[0];
  assert.equal(january.previousPeriod, null);
  assert.equal(january.deltaUsageBytes, null);
  assert.equal(january.deltaUsageGb, null);
  assert.equal(january.deltaUsagePct, null);
  assert.equal(january.deltaFileCount, null);
  assert.equal(january.deltaReportRows, null);
  assert.equal(january.year, '2026');
  assert.equal(january.month, '01');
  assert.equal(january.usageBytes, '3221225472');
  assert.equal(january.usageGb, 3);
  assert.equal(january.fileCount, 4);
  assert.equal(january.reportRows, 2);
  // Existing totals fields stay unchanged in shape and value.
  assert.deepEqual(Object.keys(totals).sort(), ['fileCount', 'reportRows', 'totalRevenue', 'usageBytes', 'usageGb']);
  assert.equal(totals.usageBytes, '3221225472');
  assert.equal(totals.usageGb, 3);
  assert.equal(totals.fileCount, 4);
  assert.equal(totals.reportRows, 2);
});

test('consecutive-month deltas include a zero month showing negative deltas', () => {
  const { months, totals } = buildCustomerYearlyMonths({
    year: '2026',
    monthlyRows: [
      monthRow('01', { usageBytes: 4n * BYTES_PER_GB, fileCount: 10, reportRows: 4 }),
      monthRow('03', { usageBytes: 2n * BYTES_PER_GB, fileCount: 3, reportRows: 1 }),
    ],
    billableMonthlyRows: [billableRow('01', 4n * BYTES_PER_GB), billableRow('03', 2n * BYTES_PER_GB)],
    reports: [report('01', 4, 2), report('03', 2, 7)],
  });

  // February has no data: zeros are kept so the March delta stays honest.
  const february = months[1];
  assert.equal(february.usageBytes, '0');
  assert.equal(february.usageGb, 0);
  assert.equal(february.fileCount, 0);
  assert.equal(february.reportRows, 0);
  assert.equal(february.previousPeriod.month, '01');
  assert.equal(february.previousPeriod.year, '2026');
  assert.equal(february.deltaUsageBytes, String(-4n * BYTES_PER_GB));
  assert.equal(february.deltaUsageGb, -4);
  assert.equal(february.deltaUsagePct, -100);
  assert.equal(february.deltaFileCount, -10);
  assert.equal(february.deltaReportRows, -4);

  const march = months[2];
  assert.deepEqual(march.previousPeriod, { year: '2026', month: '02' });
  assert.equal(march.deltaUsageBytes, String(2n * BYTES_PER_GB));
  assert.equal(march.deltaUsageGb, 2);
  // prev is 0 bytes -> percentage is null, not a division by zero.
  assert.equal(march.deltaUsagePct, null);
  assert.equal(march.deltaFileCount, 3);
  assert.equal(march.deltaReportRows, 1);

  assert.equal(totals.usageBytes, String(6n * BYTES_PER_GB));
  assert.equal(totals.reportRows, 5);
});

test('revenue is computed from billable bytes, not rounded GB, at 2 decimals', () => {
  const { months, totals } = buildCustomerYearlyMonths({
    year: '2026',
    monthlyRows: [monthRow('02', { usageBytes: 3n * BYTES_PER_GB, fileCount: 2, reportRows: 2 })],
    billableMonthlyRows: [billableRow('02', 3n * BYTES_PER_GB)],
    reports: [
      // 1.5 GB exact bytes * 3 RM/GB = 4.5, plus 1.25 GB * 2 RM/GB = 2.5 -> 7 total.
      { ...report('02', 0, 0), usageSize: (3n * BYTES_PER_GB) / 2n, pricePerGb: 3 },
      { ...report('02', 0, 0), usageSize: (5n * BYTES_PER_GB) / 4n, pricePerGb: 2 },
    ],
  });

  const february = months[1];
  assert.equal(february.usageGb, 3); // ceil(2.75) = 3 rounded GB display
  assert.equal(february.revenue, 7); // exact-bytes revenue, not 3 GB * any price
  assert.equal(totals.totalRevenue, 7);
});

test('below-threshold reports add zero revenue and totals.totalRevenue sums all months', () => {
  const { months, totals } = buildCustomerYearlyMonths({
    year: '2026',
    monthlyRows: [
      monthRow('01', { usageBytes: 5n * BYTES_PER_GB, fileCount: 1, reportRows: 1 }),
      monthRow('04', { usageBytes: 2n * BYTES_PER_GB, fileCount: 1, reportRows: 1 }),
    ],
    billableMonthlyRows: [billableRow('01', 5n * BYTES_PER_GB), billableRow('04', 2n * BYTES_PER_GB)],
    reports: [
      report('01', 5, 2.5), // 12.5
      report('04', 2, 0.75), // 1.5
      { ...report('04', 0, 99), usageSize: BYTES_PER_GB / 2n }, // below threshold: 0 revenue
    ],
  });

  assert.equal(months[0].revenue, 12.5);
  assert.equal(months[3].revenue, 1.5);
  assert.equal(totals.totalRevenue, 14);
  // Existing month fields unchanged alongside the new ones.
  assert.deepEqual(
    Object.keys(months[0]).sort(),
    ['deltaFileCount', 'deltaReportRows', 'deltaUsageBytes', 'deltaUsageGb', 'deltaUsagePct', 'fileCount', 'month', 'previousPeriod', 'reportRows', 'revenue', 'usageBytes', 'usageGb', 'year'],
  );
});

test('existing summary shapes keep their fields, BigInt usage stays string-safe', () => {
  const { months, clusters, workflowFolders } = buildCustomerYearlyMonths({
    year: '2026',
    monthlyRows: [monthRow('05', { usageBytes: 2n * BYTES_PER_GB, fileCount: 7, reportRows: 3 })],
    billableMonthlyRows: [billableRow('05', 2n * BYTES_PER_GB)],
    reports: [
      report('05', 2, 4, { fileCount: 5 }),
      report('05', 0, 4, { fileCount: 1 }),
      report('05', 0, 4, { fileCount: 1 }),
    ],
  });

  const may = months[4];
  assert.equal(may.fileCount, 7);
  assert.equal(may.reportRows, 3);
  assert.equal(may.usageBytes, '2147483648'); // string, JSON-safe BigInt
  // Clusters/workflow summaries keep their original identity fields.
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].cluster, 'D1');
  // Raw cluster rows carry BigInt; the route's formatSummary converts to string.
  assert.equal(clusters[0].usageBytes, 2147483648n);
  assert.equal(clusters[0].fileCount, 7);
  assert.equal(workflowFolders.length, 1);
  assert.equal(workflowFolders[0].workflowFolder, 'D1 - F1');
  assert.equal(workflowFolders[0].reportRows, 3);
  // revenue 2 GB * 4 = 8; below-threshold reports contribute nothing.
  assert.equal(may.revenue, 8);
});

test('customer viewer summary omits every revenue and price field while internal summary preserves revenue', () => {
  const summary = {
    customer: { custId: 'C1', name: 'Customer' },
    totals: { usageGb: 3, totalRevenue: 12.5, revenue: 12.5, pricePerGb: 2 },
    months: [{ month: '01', usageGb: 3, revenue: 12.5, price: 2 }],
    clusters: [{ cluster: 'A', usageGb: 3, totalRevenue: 12.5 }],
    workflowFolders: [{ workflowFolder: 'A - F', usageGb: 3, pricePerGb: 2 }],
  };

  const customerSafe = presentCustomerYearlySummary(summary, { includeFinancials: false });
  assert.deepEqual(customerSafe.totals, { usageGb: 3 });
  assert.deepEqual(customerSafe.months[0], { month: '01', usageGb: 3 });
  assert.deepEqual(customerSafe.clusters[0], { cluster: 'A', usageGb: 3 });
  assert.deepEqual(customerSafe.workflowFolders[0], { workflowFolder: 'A - F', usageGb: 3 });
  assert.match(JSON.stringify(customerSafe), /usageGb/);
  assert.doesNotMatch(JSON.stringify(customerSafe), /revenue|price/i);

  const internal = presentCustomerYearlySummary(summary, { includeFinancials: true });
  assert.equal(internal.totals.totalRevenue, 12.5);
  assert.equal(internal.months[0].revenue, 12.5);
});
