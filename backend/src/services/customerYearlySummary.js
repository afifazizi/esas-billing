import { billableUsageBytes, billableUsageGb } from '../utils/usageThreshold.js';

const BYTES_PER_GB = 1073741824n;
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

const FINANCIAL_FIELD = /(?:revenue|price)/i;

export function presentCustomerYearlySummary(summary, { includeFinancials = false } = {}) {
  if (includeFinancials) return summary;
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !FINANCIAL_FIELD.test(key))
        .map(([key, child]) => [key, strip(child)]),
    );
  };
  return strip(summary);
}

/**
 * Builds the 12 month rows (with consecutive-month deltas and revenue) plus the
 * year totals for the customer yearly summary.
 *
 * Inputs:
 * - monthlyRows: prisma report.groupBy by month (all rows, deletedAt null) with
 *   _sum { usageSize, fileCount } and _count { _all }.
 * - billableMonthlyRows: prisma report.groupBy by month with the billableUsageFilter,
 *   _sum { usageSize } — the per-path-thresholded byte totals.
 * - reports: prisma report.findMany rows for the year with usageSize (BigInt),
 *   fileCount, pricePerGb (Float), folderId, folder relation. Used for revenue
 *   and the cluster/workflow summaries.
 *
 * Existing fields (year, month, usageBytes, usageGb, fileCount, reportRows) are
 * produced exactly as before; only the new revenue/delta fields are added.
 */
export function buildCustomerYearlyMonths({ year, monthlyRows = [], billableMonthlyRows = [], reports = [] }) {
  const monthlyFacts = new Map(monthlyRows.map((row) => [row.month, row]));
  const billableMonthlyFacts = new Map(billableMonthlyRows.map((row) => [row.month, row]));

  // Revenue is driven by exact billable bytes per report, never rounded GB.
  const revenueByMonth = new Map();
  for (const report of reports) {
    const revenue = (Number(billableUsageBytes(report.usageSize)) / Number(BYTES_PER_GB)) * Number(report.pricePerGb || 0);
    revenueByMonth.set(report.month, (revenueByMonth.get(report.month) || 0) + revenue);
  }

  const clusters = new Map();
  const workflowFolders = new Map();
  for (const report of reports) {
    const usageBytes = billableUsageBytes(report.usageSize);
    const fileCount = report.fileCount || 0;
    const cluster = report.folder.department.deptName;
    const workflowFolder = `${cluster} - ${report.folder.folderName}`;
    const add = (map, key, identity) => {
      const value = map.get(key) || { ...identity, usageBytes: 0n, fileCount: 0, reportRows: 0 };
      value.usageBytes += usageBytes;
      value.fileCount += fileCount;
      value.reportRows += 1;
      map.set(key, value);
    };
    add(clusters, cluster, { cluster });
    add(workflowFolders, report.folderId, { cluster, workflowFolder });
  }

  // Pass 1: base month rows (existing fields + revenue), no self-reference.
  const baseRows = MONTHS.map((month) => {
    const row = monthlyFacts.get(month);
    const usageBytes = billableMonthlyFacts.get(month)?._sum.usageSize || 0n;
    return {
      year,
      month,
      usageBytes: String(usageBytes),
      usageGb: bytesToGb(usageBytes),
      fileCount: row?._sum.fileCount || 0,
      reportRows: row?._count._all || 0,
      revenue: roundMoney(revenueByMonth.get(month) || 0),
    };
  });

  // Pass 2: consecutive-month deltas WITHIN the selected year. January has no
  // previous period inside the year, so all its deltas are null. Months with
  // no data keep zeros so a zero after data shows an honest negative delta.
  const months = baseRows.map((current, index) => {
    const previous = index > 0 ? baseRows[index - 1] : null;
    const previousPeriod = previous ? { year, month: MONTHS[index - 1] } : null;

    let deltaUsageBytes = null;
    let deltaUsageGb = null;
    let deltaUsagePct = null;
    let deltaFileCount = null;
    let deltaReportRows = null;
    if (previous) {
      const curBytes = BigInt(current.usageBytes);
      const prevBytes = BigInt(previous.usageBytes);
      const byteDiff = curBytes - prevBytes;
      deltaUsageBytes = String(byteDiff);
      deltaUsageGb = Number((Number(byteDiff) / Number(BYTES_PER_GB)).toFixed(3));
      // null when the previous total is 0 — a percentage would be undefined.
      deltaUsagePct = prevBytes === 0n ? null : roundPct((Number(byteDiff) / Number(prevBytes)) * 100);
      deltaFileCount = current.fileCount - previous.fileCount;
      deltaReportRows = current.reportRows - previous.reportRows;
    }

    return {
      ...current,
      deltaUsageBytes,
      deltaUsageGb,
      deltaUsagePct,
      deltaFileCount,
      deltaReportRows,
      previousPeriod,
    };
  });

  const totalUsageBytes = months.reduce((sum, month) => sum + BigInt(month.usageBytes), 0n);
  const totalFileCount = months.reduce((sum, month) => sum + month.fileCount, 0);
  const totalReportRows = months.reduce((sum, month) => sum + month.reportRows, 0);
  // Sum the already-rounded month revenues, then round once more at the year
  // boundary to keep the total consistent with the displayed month figures.
  const totalRevenue = roundMoney(months.reduce((sum, month) => sum + month.revenue, 0));

  return {
    months,
    clusters: [...clusters.values()],
    workflowFolders: [...workflowFolders.values()],
    totals: {
      usageBytes: String(totalUsageBytes),
      usageGb: bytesToGb(totalUsageBytes),
      fileCount: totalFileCount,
      reportRows: totalReportRows,
      totalRevenue,
    },
  };
}

function bytesToGb(bytes) {
  return billableUsageGb(bytes);
}
