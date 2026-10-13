// Local pure synthesizer used by the generated-PDF verification script and tests.
// Mirrors the payload produced by /api/export/pdf-data without an HTTP server.
import { monthName, monthShort, deriveCustomerCode, buildReportId, buildMonthlyHistory, buildValidationRows, buildScopeChanges, buildClusterMonthComparison, buildMonthComparison, buildMomDifferenceMatrix, computeRevenue, totalBillableBytes, usageGbFromBytes } from './pdfTemplate.js';
import { buildRenderPlan, renderPdf, footerLeft } from './pdfLayout.js';
import * as charts from './pdfCharts.js';

export function buildPdfPayloadForCustomer({ customer, custId, month, year, reports, folderCount, pendingUnmatched, generatedAt = new Date(), historyRows = null, layoutOptions = {} }) {
  const monthLabel = `${monthName(month)} ${year}`;
  const curMonthKey = String(month).padStart(2, '0');
  const prevMonthNum = Number(month) - 1;
  const prevMonthKey = String(prevMonthNum).padStart(2, '0');

  const totalBytes = totalBillableBytes(reports);
  const pricePerGb = Number(customer?.prices?.[0]?.price || reports[0]?.pricePerGb || 0);
  const totalUsageGb = usageGbFromBytes(totalBytes);
  const totalRevenue = computeRevenue(reports);

  // Normalized rows carrying cluster/label used by historical helpers.
  // `historyRows` (full same-year rows) overrides the current-month-only default.
  const rows = historyRows ?? reports.map((r) => ({
    year,
    month: r.month,
    folderId: r.folderId,
    usageSize: r.usageSize,
    clusterName: r.clusterName,
    pathLabel: r.pathLabel,
    pricePerGb: r.pricePerGb,
  }));

  const monthly = buildMonthlyHistory(year, month, rows);
  const monthlySeries = monthly.map((s) => ({
    label: s.label,
    labelShort: monthShort(s.month),
    usageTb: s.usageTb,
    usageTbNum: Number(s.usageTb),
    usagePb: s.usagePb,
    momPct: s.momPct,
  }));

  // Isilon rows: cluster asc then folder asc.
  const sorted = [...reports].sort((a, b) => {
    const ca = String(a.clusterName).localeCompare(String(b.clusterName));
    if (ca !== 0) return ca;
    return String(a.pathLabel).localeCompare(String(b.pathLabel));
  });
  const isilon = sorted.map((row, index) => ({
    no: index + 1,
    cluster: row.clusterName,
    workflowFolder: row.pathLabel,
    sizeGb: usageGbFromBytes(row.usageSize),
  }));

  const byFolder = new Map();
  const byCluster = new Map();
  for (const row of reports) {
    byFolder.set(row.pathLabel, (byFolder.get(row.pathLabel) || 0n) + BigInt(row.usageSize));
    byCluster.set(row.clusterName, (byCluster.get(row.clusterName) || 0n) + BigInt(row.usageSize));
  }
  const gb = (bytes) => usageGbFromBytes(bytes);
  const workfolderSummary = [...byFolder.entries()]
    .map(([folderName, bytes]) => ({ folderName, sizeGb: gb(bytes) }))
    .sort((a, b) => b.sizeGb - a.sizeGb);
  const departmentalSummary = [...byCluster.entries()]
    .map(([deptName, bytes]) => ({
      deptName,
      sizeGb: gb(bytes),
      sharePct: totalBytes ? Math.round((Number(bytes) / Number(totalBytes)) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.sizeGb - a.sizeGb);

  // 5.2 cluster trend, values keyed by month short label and expressed in TB.
  const trendMonths = monthlySeries.map((s) => s.labelShort);
  const perClusterMonth = buildClusterMonthComparison(rows, { month, year });
  const clusterByteSeries = new Map();
  for (const row of rows) {
    if (Number(row.year) !== Number(year) || Number(row.month) > Number(month)) continue;
    const cluster = row.clusterName || 'Unknown';
    if (!clusterByteSeries.has(cluster)) clusterByteSeries.set(cluster, new Map());
    const byMonth = clusterByteSeries.get(cluster);
    const short = monthShort(row.month);
    byMonth.set(short, (byMonth.get(short) || 0n) + BigInt(row.usageSize));
  }
  const currentShort = monthShort(curMonthKey);
  const trendClusters = [...clusterByteSeries.entries()]
    .sort((a, b) => Number(b[1].get(currentShort) || 0n) - Number(a[1].get(currentShort) || 0n));
  const toTb = (bytes) => Number(bytes || 0n) / 1024 / 1073741824;
  const clusterTrend = trendClusters.map(([name, byMonth]) => ({
    name,
    values: Object.fromEntries(trendMonths.map((m) => [m, toTb(byMonth.get(m) || 0n)])),
  }));
  const clusterTrendTable = trendClusters.map(([name, byMonth]) => ({
    cluster: name,
    values: trendMonths.map((m) => toTb(byMonth.get(m) || 0n).toFixed(2)),
  }));

  const curBytes = BigInt(monthly.find((s) => s.month === curMonthKey)?.bytes || 0n);
  const prevBytes = prevMonthNum >= 1 ? BigInt(monthly.find((s) => s.month === prevMonthKey)?.bytes || 0n) : 0n;
  const cmp = buildMonthComparison(month, year, curBytes, prevBytes);
  const monthComparison = [
    { metric: 'Historical Total', prev: `${cmp.prevTb} TB`, current: `${cmp.curTb} TB`, change: `${cmp.change} TB`, changePct: cmp.changePct },
  ];

  const custCode = deriveCustomerCode(customer?.custName || custId, custId);
  const dataCutoff = `${lastDay(month, year)} ${monthName(month)} ${year}, 23:59 MYT`;

  return {
    custId,
    customer: customer?.custName || custId,
    month: String(month).padStart(2, '0'),
    year: String(year),
    status: reports.length ? 'DRAFT' : 'EMPTY',
    pricePerGb,
    totalUsageGb,
    totalRevenue,
    rowCount: reports.length,
    pendingUnmatched,
    generatedAt,
    reportId: buildReportId(custCode, year, String(month).padStart(2, '0')),
    metadata: [
      { label: 'Customer', value: customer?.custName || custId },
      { label: 'Report Month', value: monthLabel },
      { label: 'Report Period', value: `1 - ${lastDay(month, year)} ${monthName(month)} ${year}` },
      { label: 'Data Cut-off', value: dataCutoff },
      { label: 'Report ID', value: buildReportId(custCode, year, String(month).padStart(2, '0')) },
      { label: 'Generated Date/Time', value: fmtGenerated(generatedAt) },
      { label: 'Generated By', value: 'ESAS Billing System' },
    ],
    validation: buildValidationRows({
      monthLabel,
      expectedPaths: folderCount,
      receivedPaths: new Set(reports.map((report) => report.folderId)).size,
      rowCount: reports.length,
      pendingUnmatched,
      monthsOfHistory: monthly.length,
    }),
    isilon,
    workfolderChart: workfolderSummary,
    workfolderSummary,
    clusterChart: departmentalSummary,
    departmentalSummary,
    monthlySeries,
    trendMonths,
    clusterTrend,
    clusterTrendTable,
    scopeChanges: buildScopeChanges(rows, { month, year }),
    monthComparison,
    clusterMomTable: perClusterMonth.map((r) => ({
      cluster: r.cluster,
      prevTb: r.prevTb,
      curTb: r.curTb,
      change: `${Number(r.change) > 0 ? '+' : ''}${r.change}`,
      changePct: r.changePct,
    })),
    curMonthLabel: `${monthShort(curMonthKey)} ${year}`,
    prevMonthLabel: prevMonthNum >= 1 ? `${monthShort(prevMonthKey)} ${year}` : 'N/A',
    momMatrix: buildMomDifferenceMatrix(rows, { month, year }),
    dataCutoff,
    trendPeriod: `January to ${monthName(month)} ${year}`,
    generatedBy: 'ESAS Billing System',
    generatedAtMYT: fmtGenerated(generatedAt),
  };
}

function lastDay(month, year) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function fmtGenerated(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} MYT`;
}
