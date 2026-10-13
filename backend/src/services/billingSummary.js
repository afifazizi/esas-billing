import { BYTES_PER_GB, exactBillableUsageGb, sumBillableUsageBytes } from '../utils/usageThreshold.js';

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pricePayload(price) {
  return price ? { id: price.id, label: price.label || null, price: Number(price.price), isDefault: Boolean(price.isDefault), effectiveFrom: price.effectiveFrom || null, effectiveTo: price.effectiveTo || null } : null;
}

export function buildBillingCustomerSummary({ customer, reports, period, imports, pendingUnmatched, month, year }) {
  const lifecycleStatus = period?.status || 'DRAFT';
  const usageBytes = sumBillableUsageBytes(reports, (report) => report.usageSize);
  const revenue = reports.reduce((sum, report) => sum + exactBillableUsageGb(report.usageSize) * Number(report.pricePerGb || 0), 0);
  const defaultPrice = customer.prices?.find((price) => price.isDefault) || null;
  const periodDate = new Date(`${year}-${month}-01T00:00:00.000Z`);
  const applicablePrices = (customer.prices || []).filter((price) => {
    const starts = !price.effectiveFrom || new Date(price.effectiveFrom) <= periodDate;
    const ends = !price.effectiveTo || new Date(price.effectiveTo) >= periodDate;
    return starts && ends;
  });
  const currentPrice = applicablePrices.sort((a, b) => {
    const aDated = a.effectiveFrom || a.effectiveTo ? 1 : 0;
    const bDated = b.effectiveFrom || b.effectiveTo ? 1 : 0;
    if (aDated !== bDated) return bDated - aDated;
    const aStart = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : Number.NEGATIVE_INFINITY;
    const bStart = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : Number.NEGATIVE_INFINITY;
    if (aStart !== bStart) return bStart - aStart;
    return Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault));
  })[0] || defaultPrice || customer.prices?.[0] || null;
  const latestImport = imports[0] || null;
  const issues = [];
  if (reports.length === 0) issues.push({ code: 'MISSING_REPORT', severity: 'blocking', message: 'No report rows exist for this period' });
  if (!currentPrice) issues.push({ code: 'MISSING_PRICE', severity: 'blocking', message: 'No current or default price is configured' });
  if (pendingUnmatched > 0) issues.push({ code: 'PENDING_UNMATCHED', severity: 'blocking', message: `${pendingUnmatched} unmatched path${pendingUnmatched === 1 ? '' : 's'} require action` });
  if (latestImport?.status === 'FAILED') issues.push({ code: 'FAILED_IMPORT', severity: 'blocking', message: 'The latest import failed' });
  if (latestImport?.status === 'PARTIAL') issues.push({ code: 'PARTIAL_IMPORT', severity: 'blocking', message: 'The latest import completed partially' });
  if (reports.length > 0 && lifecycleStatus === 'DRAFT') issues.push({ code: 'AWAITING_REVIEW', severity: 'info', message: 'Report period is awaiting review' });
  if (lifecycleStatus === 'REVIEWED') issues.push({ code: 'AWAITING_APPROVAL', severity: 'info', message: 'Report period is awaiting approval' });
  const hasBlockingIssue = issues.some((issue) => issue.severity === 'blocking');

  return {
    custId: customer.custId,
    custName: customer.custName,
    month,
    year,
    lifecycleStatus,
    lifecycleVersion: period?.version || 1,
    reportRowCount: reports.length,
    usageBytes: String(usageBytes),
    usageGb: Number((Number(usageBytes) / Number(BYTES_PER_GB)).toFixed(3)),
    revenue: roundMoney(revenue),
    latestImport: latestImport ? {
      id: latestImport.id,
      fileName: latestImport.fileName,
      status: latestImport.status,
      matchedCount: latestImport.matchedCount,
      unmatchedCount: latestImport.unmatchedCount,
      insertedCount: latestImport.insertedCount,
      skippedCount: latestImport.skippedCount,
      createdAt: latestImport.createdAt,
    } : null,
    latestImportStatus: latestImport?.status || null,
    pendingUnmatchedCount: pendingUnmatched,
    priceInfo: {
      current: pricePayload(currentPrice),
      default: pricePayload(defaultPrice),
      appliedPriceIds: [...new Set(reports.map((report) => report.priceId).filter(Boolean))],
    },
    readiness: {
      ready: !hasBlockingIssue && ['APPROVED', 'LOCKED'].includes(lifecycleStatus),
      readyForReview: !hasBlockingIssue && lifecycleStatus === 'DRAFT',
      readyForApproval: !hasBlockingIssue && lifecycleStatus === 'REVIEWED',
      readyForLock: !hasBlockingIssue && lifecycleStatus === 'APPROVED',
      issues,
    },
  };
}
