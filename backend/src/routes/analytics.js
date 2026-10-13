import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import {
  billableUsageBytes,
  billableUsageFilter,
  billableUsageGb,
  exactBillableUsageGb,
  sumBillableUsageBytes,
} from '../utils/usageThreshold.js';
import { buildCustomerYearlyMonths, presentCustomerYearlySummary } from '../services/customerYearlySummary.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.use((req, res, next) => {
  if (req.user?.role !== 'customer_viewer') return next();
  const allowed = req.method === 'GET' && ['/report-availability', '/report-detail', '/customer-usage-comparison', '/customer-yearly-summary'].includes(req.path);
  if (!allowed) return res.status(403).json({ error: 'Customer users can only view their own usage' });
  if (!req.user.custId) return res.status(403).json({ error: 'Customer scope is required' });
  next();
});

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function getYearParam(req) {
  const year = req.query.year || String(new Date().getFullYear());
  const y = String(year);
  if (!/^\d{4}$/.test(y)) {
    const err = new Error('year must be a four-digit year');
    err.status = 400;
    throw err;
  }
  return y;
}

function getMonthParam(req) {
  const { month } = req.query;
  if (month === undefined || month === null || month === '') return null;
  const m = String(month).padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(m)) {
    const err = new Error('month must be between 01 and 12');
    err.status = 400;
    throw err;
  }
  return m;
}

function bytesToGb(bytes) {
  return billableUsageGb(bytes);
}


async function getEffectiveCustomerId(req) {
  if (req.user?.role === 'customer_viewer') {
    const requested = req.query.cust_id ? await resolveCustomerId(req.query.cust_id) : req.user.custId;
    if (requested && requested !== req.user.custId) {
      const err = new Error('Customer scope mismatch');
      err.status = 403;
      throw err;
    }
    return req.user.custId;
  }
  return resolveCustomerId(req.query.cust_id);
}

function monthLabel(month, year) {
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
}

function previousPeriods({ month, year, count }) {
  const periods = [];
  const start = new Date(Number(year), Number(month) - 1, 1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    periods.push({ year: String(d.getFullYear()), month: String(d.getMonth() + 1).padStart(2, '0') });
  }
  return periods;
}

async function resolveCustomerId(custId) {
  const requested = String(custId || '').trim();
  if (!requested) return requested;

  const exact = await prisma.customer.findUnique({
    where: { custId: requested },
    select: { custId: true },
  });
  if (exact) return exact.custId;

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { custId: true },
  });
  return customers.find((customer) => customer.custId.toLowerCase() === requested.toLowerCase())?.custId || requested;
}

// GET /api/analytics/dashboard
analyticsRouter.get('/dashboard', async (req, res, next) => {
  try {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());

    const [totalCustomers, usageResult, revenueResult, activeReports] = await Promise.all([
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.report.aggregate({
        _sum: { usageSize: true },
        where: { deletedAt: null, month, year, usageSize: billableUsageFilter() },
      }),
      prisma.report.findMany({
        where: { deletedAt: null, month, year },
        select: { usageSize: true, pricePerGb: true },
      }),
      prisma.report.count({ where: { deletedAt: null, month, year } }),
    ]);

    const totalUsageBytes = usageResult._sum.usageSize || 0n;
    const totalUsageGB = bytesToGb(totalUsageBytes);
    const totalUsageTB = (Number(totalUsageBytes) / 1099511627776).toFixed(2);

    const totalRevenue = revenueResult.reduce((sum, r) => {
      return sum + exactBillableUsageGb(r.usageSize) * Number(r.pricePerGb);
    }, 0);

    res.json({
      totalCustomers,
      totalUsageGB,
      totalUsageTB,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      activeReports,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/usage-by-customer
// Legacy monthly snapshot used by the current dashboard pie chart.
// Query: ?month=MM&year=YYYY. Defaults to current month/year.
analyticsRouter.get('/usage-by-customer', async (req, res, next) => {
  try {
    const m = getMonthParam(req) || String(new Date().getMonth() + 1).padStart(2, '0');
    const y = getYearParam(req);

    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const result = await Promise.all(customers.map(async (customer) => {
      const agg = await prisma.report.aggregate({
        _sum: { usageSize: true },
        where: {
          custId: customer.custId,
          month: m,
          year: y,
          deletedAt: null,
          usageSize: billableUsageFilter(),
        },
      });
      return {
        cust_id: customer.custId,
        cust_name: customer.custName,
        month: m,
        year: y,
        total_usage: Number(agg._sum.usageSize || 0n),
        total_usage_bytes: String(agg._sum.usageSize || 0n),
        total_usage_gb: bytesToGb(agg._sum.usageSize || 0n),
      };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/usage-by-customer-monthly
// Year-aware monthly customer usage series for the main dashboard.
// Query: ?year=YYYY. Defaults to current year.
analyticsRouter.get('/usage-by-customer-monthly', async (req, res, next) => {
  try {
    const year = getYearParam(req);

    const [customers, usageByCustomerMonth] = await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null },
        select: { custId: true, custName: true },
        orderBy: { custName: 'asc' },
      }),
      prisma.report.groupBy({
        by: ['custId', 'month'],
        where: { year, deletedAt: null, usageSize: billableUsageFilter() },
        _sum: { usageSize: true },
      }),
    ]);

    const usageMap = new Map();
    for (const row of usageByCustomerMonth) {
      usageMap.set(`${row.custId}:${row.month}`, row._sum.usageSize || 0n);
    }

    const result = customers.map((customer) => {
      const monthly_usage = MONTHS.map((month) => {
        const bytes = usageMap.get(`${customer.custId}:${month}`) || 0n;
        return {
          month,
          total_usage_bytes: String(bytes),
          total_usage_gb: bytesToGb(bytes),
        };
      });
      const totalBytes = monthly_usage.reduce((sum, m) => sum + BigInt(m.total_usage_bytes), 0n);

      return {
        cust_id: customer.custId,
        cust_name: customer.custName,
        year,
        total_usage_bytes: String(totalBytes),
        total_usage_gb: bytesToGb(totalBytes),
        monthly_usage,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/revenue
analyticsRouter.get('/revenue', async (req, res, next) => {
  try {
    const year = getYearParam(req);

    const result = await Promise.all(MONTHS.map(async (m) => {
      const reports = await prisma.report.findMany({
        where: { year, month: m, deletedAt: null },
        select: { usageSize: true, pricePerGb: true },
      });
      const totalUsage = reports.reduce((sum, r) => sum + Number(billableUsageBytes(r.usageSize)), 0);
      const price = reports[0]?.pricePerGb || 0;
      return { month: m, year, total_usage: totalUsage, price: Number(price) };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/storage-trend
analyticsRouter.get('/storage-trend', async (req, res, next) => {
  try {
    const year = getYearParam(req);

    const result = await Promise.all(MONTHS.map(async (m) => {
      const agg = await prisma.report.aggregate({
        _sum: { usageSize: true },
        where: { year, month: m, deletedAt: null, usageSize: billableUsageFilter() },
      });
      return {
        month: m,
        year,
        total_bytes: String(agg._sum.usageSize || 0n),
        total_gb: bytesToGb(agg._sum.usageSize || 0n),
        total_pb: (Number(agg._sum.usageSize || 0n) / 1125899906842624).toFixed(4),
      };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});


function revenueFromReports(reports) {
  return reports.reduce((sum, r) => {
    return sum + exactBillableUsageGb(r.usageSize) * Number(r.pricePerGb || 0);
  }, 0);
}

function monthLimitForYear(year) {
  const now = new Date();
  const currentYear = String(now.getFullYear());
  if (year === currentYear) return now.getMonth() + 1;
  return 12;
}

async function getYearReportFacts(year) {
  const [totalCustomers, usageResult, reports, reportMonths, importRuns, pendingUnmatched, reportPeriods] = await Promise.all([
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.report.aggregate({
      _sum: { usageSize: true },
      where: { deletedAt: null, year, usageSize: billableUsageFilter() },
    }),
    prisma.report.findMany({
      where: { deletedAt: null, year },
      select: { custId: true, usageSize: true, pricePerGb: true },
    }),
    prisma.report.groupBy({
      by: ['custId', 'month'],
      where: { deletedAt: null, year },
      _count: { _all: true },
    }),
    prisma.importRun.findMany({
      where: { year },
      select: { id: true, status: true, unmatchedCount: true, insertedCount: true, skippedCount: true },
    }),
    prisma.unmatchedDirectory.count({
      where: { status: 'PENDING', importRun: { year } },
    }),
    prisma.reportPeriod.findMany({
      where: { year },
      select: { custId: true, month: true, status: true },
    }),
  ]);

  const activeCustomerIds = new Set(reports.map((r) => r.custId));
  const monthLimit = monthLimitForYear(year);
  const expectedReports = totalCustomers * monthLimit;
  const uploadedReports = reportMonths.length;
  const totalUsageBytes = usageResult._sum.usageSize || 0n;
  const totalRevenue = revenueFromReports(reports);
  const partialImports = importRuns.filter((run) => run.status === 'PARTIAL').length;
  const failedImports = importRuns.filter((run) => run.status === 'FAILED').length;
  const lifecycleMap = new Map(reportPeriods.map((period) => [`${period.custId}:${period.month}`, period.status]));
  const awaitingReview = reportMonths.filter((period) => (lifecycleMap.get(`${period.custId}:${period.month}`) || 'DRAFT') === 'DRAFT').length;
  const awaitingApproval = reportMonths.filter((period) => lifecycleMap.get(`${period.custId}:${period.month}`) === 'REVIEWED').length;

  return {
    totalCustomers,
    activeCustomers: activeCustomerIds.size,
    totalUsageBytes,
    totalUsageGB: bytesToGb(totalUsageBytes),
    totalUsageTB: (Number(totalUsageBytes) / 1099511627776).toFixed(2),
    totalUsagePB: Number((Number(totalUsageBytes) / 1125899906842624).toFixed(4)),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    uploadedReports,
    expectedReports,
    reportCompletionPct: expectedReports ? Math.round((uploadedReports / expectedReports) * 100) : 0,
    pendingUnmatched,
    partialImports,
    failedImports,
    awaitingReview,
    awaitingApproval,
  };
}

// GET /api/analytics/dashboard-summary
// Year-aware executive summary for the command-center dashboard.
analyticsRouter.get('/dashboard-summary', async (req, res, next) => {
  try {
    const year = getYearParam(req);
    const facts = await getYearReportFacts(year);

    const topCustomer = await prisma.report.groupBy({
      by: ['custId'],
      where: { deletedAt: null, year, usageSize: billableUsageFilter() },
      _sum: { usageSize: true },
      orderBy: { _sum: { usageSize: 'desc' } },
      take: 1,
    });

    let topCustomerPayload = null;
    if (topCustomer.length > 0) {
      const customer = await prisma.customer.findUnique({
        where: { custId: topCustomer[0].custId },
        select: { custId: true, custName: true },
      });
      const bytes = topCustomer[0]._sum.usageSize || 0n;
      topCustomerPayload = {
        custId: topCustomer[0].custId,
        custName: customer?.custName || topCustomer[0].custId,
        totalUsageBytes: String(bytes),
        totalUsageGb: bytesToGb(bytes),
        totalUsagePb: Number((Number(bytes) / 1125899906842624).toFixed(4)),
      };
    }

    res.json({ year, ...facts, totalUsageBytes: String(facts.totalUsageBytes), topCustomer: topCustomerPayload });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/top-customers
analyticsRouter.get('/top-customers', async (req, res, next) => {
  try {
    const year = getYearParam(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 10);
    const grouped = await prisma.report.groupBy({
      by: ['custId'],
      where: { deletedAt: null, year, usageSize: billableUsageFilter() },
      _sum: { usageSize: true },
      _count: { _all: true },
      orderBy: { _sum: { usageSize: 'desc' } },
      take: limit,
    });
    const customers = await prisma.customer.findMany({
      where: { custId: { in: grouped.map((row) => row.custId) } },
      select: { custId: true, custName: true },
    });
    const names = new Map(customers.map((customer) => [customer.custId, customer.custName]));
    const totalBytes = grouped.reduce((sum, row) => sum + BigInt(row._sum.usageSize || 0n), 0n);

    res.json(grouped.map((row, index) => {
      const bytes = row._sum.usageSize || 0n;
      return {
        rank: index + 1,
        custId: row.custId,
        custName: names.get(row.custId) || row.custId,
        reportCount: row._count._all,
        totalUsageBytes: String(bytes),
        totalUsageGb: bytesToGb(bytes),
        totalUsagePb: Number((Number(bytes) / 1125899906842624).toFixed(4)),
        sharePct: totalBytes > 0n ? Math.round((Number(bytes) / Number(totalBytes)) * 100) : 0,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/recent-imports
analyticsRouter.get('/recent-imports', async (req, res, next) => {
  try {
    const year = getYearParam(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 10);
    const runs = await prisma.importRun.findMany({
      where: { year },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { custId: true, custName: true } } },
    });

    res.json(runs.map((run) => ({
      id: run.id,
      fileName: run.fileName,
      month: run.month,
      year: run.year,
      status: run.status,
      matchedCount: run.matchedCount,
      unmatchedCount: run.unmatchedCount,
      insertedCount: run.insertedCount,
      skippedCount: run.skippedCount,
      createdAt: run.createdAt,
      customer: run.customer ? { custId: run.customer.custId, custName: run.customer.custName } : null,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/attention-items
analyticsRouter.get('/attention-items', async (req, res, next) => {
  try {
    const year = getYearParam(req);
    const facts = await getYearReportFacts(year);
    const items = [];

    if (facts.pendingUnmatched > 0) {
      items.push({
        key: 'pending-unmatched',
        severity: 'warning',
        title: 'Unmatched paths pending review',
        description: `${facts.pendingUnmatched} directory path${facts.pendingUnmatched === 1 ? '' : 's'} need mapping or ignore action.`,
        count: facts.pendingUnmatched,
        href: `/dashboard/unmatched-directories?status=PENDING&year=${year}`,
        action: { type: 'filter', resource: 'unmatched-directories', filters: { status: 'PENDING', year }, apiHref: `/api/unmatched-directories?status=PENDING&year=${year}` },
      });
    }

    if (facts.partialImports > 0) {
      items.push({
        key: 'partial-imports',
        severity: 'warning',
        title: 'Partial imports this year',
        description: `${facts.partialImports} upload run${facts.partialImports === 1 ? '' : 's'} completed with unmatched data.`,
        count: facts.partialImports,
        href: `/dashboard/import-runs?status=PARTIAL&year=${year}`,
        action: { type: 'filter', resource: 'import-runs', filters: { status: 'PARTIAL', year }, apiHref: `/api/import-runs?status=PARTIAL&year=${year}` },
      });
    }

    if (facts.failedImports > 0) {
      items.push({
        key: 'failed-imports',
        severity: 'critical',
        title: 'Failed imports this year',
        description: `${facts.failedImports} upload run${facts.failedImports === 1 ? '' : 's'} failed and should be investigated.`,
        count: facts.failedImports,
        href: `/dashboard/import-runs?status=FAILED&year=${year}`,
        action: { type: 'filter', resource: 'import-runs', filters: { status: 'FAILED', year }, apiHref: `/api/import-runs?status=FAILED&year=${year}` },
      });
    }

    if (facts.reportCompletionPct < 100) {
      const missing = Math.max(facts.expectedReports - facts.uploadedReports, 0);
      items.push({
        key: 'report-coverage',
        severity: missing > 0 ? 'info' : 'ok',
        title: 'Report coverage below target',
        description: `${facts.uploadedReports}/${facts.expectedReports} expected customer-month reports are present for ${year}.`,
        count: missing,
        href: `/dashboard/billing?year=${year}&filter=ACTION_REQUIRED`,
        action: { type: 'filter', resource: 'reports', filters: { year, missing: true } },
      });
    }

    if (facts.awaitingReview > 0) {
      items.push({
        key: 'awaiting-review',
        severity: 'info',
        title: 'Reports awaiting review',
        description: `${facts.awaitingReview} customer-month report${facts.awaitingReview === 1 ? '' : 's'} are still in DRAFT.`,
        count: facts.awaitingReview,
        href: `/dashboard/billing?year=${year}&filter=DRAFT`,
        action: { type: 'filter', resource: 'report-periods', filters: { year, status: 'DRAFT' } },
      });
    }

    if (facts.awaitingApproval > 0) {
      items.push({
        key: 'awaiting-approval',
        severity: 'warning',
        title: 'Reports awaiting approval',
        description: `${facts.awaitingApproval} customer-month report${facts.awaitingApproval === 1 ? '' : 's'} are REVIEWED and need admin approval.`,
        count: facts.awaitingApproval,
        href: `/dashboard/billing?year=${year}&filter=REVIEWED`,
        action: { type: 'filter', resource: 'report-periods', filters: { year, status: 'REVIEWED' } },
      });
    }

    if (items.length === 0) {
      items.push({
        key: 'all-clear',
        severity: 'ok',
        title: 'No operational issues detected',
        description: `Imports, unmatched paths, and report coverage are clear for ${year}.`,
        count: 0,
        href: '/dashboard',
      });
    }

    res.json(items);
  } catch (err) {
    next(err);
  }
});



// GET /api/analytics/customer-usage-comparison
analyticsRouter.get('/customer-usage-comparison', async (req, res, next) => {
  try {
    const requestedMonths = Math.min(Math.max(Number(req.query.months || 3), 2), 3);
    const resolvedCustId = await getEffectiveCustomerId(req);
    let anchorMonth = req.query.month ? getMonthParam(req) : null;
    let anchorYear = req.query.year ? getYearParam(req) : null;

    if (!anchorMonth || !anchorYear) {
      const latest = await prisma.report.findFirst({
        where: { custId: resolvedCustId, deletedAt: null },
        select: { month: true, year: true },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      const now = new Date();
      anchorMonth = latest?.month || String(now.getMonth() + 1).padStart(2, '0');
      anchorYear = latest?.year || String(now.getFullYear());
    }

    const periods = previousPeriods({ month: anchorMonth, year: anchorYear, count: requestedMonths });
    const periodKeys = periods.map((p) => `${p.year}-${p.month}`);

    const customer = await prisma.customer.findUnique({
      where: { custId: resolvedCustId },
      select: { custId: true, custName: true },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const reports = await prisma.report.findMany({
      where: {
        custId: resolvedCustId,
        deletedAt: null,
        OR: periods.map((period) => ({ year: period.year, month: period.month })),
      },
      include: { folder: { include: { department: true } } },
      orderBy: [
        { year: 'asc' },
        { month: 'asc' },
        { folder: { department: { deptName: 'asc' } } },
        { folder: { folderName: 'asc' } },
      ],
    });

    const byPeriod = new Map(periodKeys.map((key) => [key, {
      key,
      year: key.slice(0, 4),
      month: key.slice(5, 7),
      label: monthLabel(key.slice(5, 7), key.slice(0, 4)),
      totalUsageBytes: '0',
      totalUsageGb: 0,
      totalFileCount: 0,
      reportRows: 0,
      folders: [],
    }]));

    const clusterMap = new Map();
    const folderMap = new Map();

    for (const report of reports) {
      const key = `${report.year}-${report.month}`;
      const period = byPeriod.get(key);
      if (!period) continue;
      const usageBytes = billableUsageBytes(report.usageSize);
      const sizeGb = bytesToGb(usageBytes);
      period.totalUsageBytes = String(BigInt(period.totalUsageBytes) + usageBytes);
      period.totalFileCount += report.fileCount || 0;
      period.reportRows += 1;

      const cluster = report.folder.department.deptName;
      const workflowFolder = `${cluster} - ${report.folder.folderName}`;
      const folderRow = {
        folderId: report.folderId,
        cluster,
        workflowFolder,
        usageBytes: String(usageBytes),
        usageGb: sizeGb,
        fileCount: report.fileCount || 0,
      };
      period.folders.push(folderRow);

      const clusterKey = cluster;
      if (!clusterMap.has(clusterKey)) clusterMap.set(clusterKey, { cluster, periods: Object.fromEntries(periodKeys.map((k) => [k, { usageBytes: '0', usageGb: 0, fileCount: 0 }])) });
      const clusterPeriod = clusterMap.get(clusterKey).periods[key];
      clusterPeriod.usageBytes = String(BigInt(clusterPeriod.usageBytes) + usageBytes);
      clusterPeriod.fileCount += report.fileCount || 0;

      const folderKey = `${cluster}||${workflowFolder}`;
      if (!folderMap.has(folderKey)) folderMap.set(folderKey, { cluster, workflowFolder, periods: Object.fromEntries(periodKeys.map((k) => [k, { usageBytes: '0', usageGb: 0, fileCount: 0 }])) });
      const folderPeriod = folderMap.get(folderKey).periods[key];
      folderPeriod.usageBytes = String(BigInt(folderPeriod.usageBytes) + usageBytes);
      folderPeriod.fileCount += report.fileCount || 0;
    }

    for (const period of byPeriod.values()) {
      period.totalUsageGb = bytesToGb(BigInt(period.totalUsageBytes));
      period.folders.sort((a, b) => a.cluster.localeCompare(b.cluster) || a.workflowFolder.localeCompare(b.workflowFolder));
    }
    for (const summary of [...clusterMap.values(), ...folderMap.values()]) {
      for (const period of Object.values(summary.periods)) {
        period.usageGb = bytesToGb(BigInt(period.usageBytes));
      }
    }

    res.json({
      customer: { custId: customer.custId, name: customer.custName },
      periodKeys,
      months: [...byPeriod.values()],
      clusters: [...clusterMap.values()].sort((a, b) => a.cluster.localeCompare(b.cluster)),
      workflowFolders: [...folderMap.values()].sort((a, b) => a.cluster.localeCompare(b.cluster) || a.workflowFolder.localeCompare(b.workflowFolder)),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/customer-yearly-summary
// Customer-safe, full-year dashboard data. Customer viewers are always scoped
// to the custId embedded in their access token; internal users must explicitly
// select a customer so this endpoint can never return cross-customer totals.
analyticsRouter.get('/customer-yearly-summary', async (req, res, next) => {
  try {
    const year = getYearParam(req);
    const hasRequestedCustomer = String(req.query.cust_id || '').trim().length > 0;
    if (req.user?.role !== 'customer_viewer' && !hasRequestedCustomer) {
      return res.status(400).json({ error: 'cust_id is required' });
    }

    const custId = await getEffectiveCustomerId(req);
    const customer = await prisma.customer.findFirst({
      where: { custId, deletedAt: null },
      select: { custId: true, custName: true },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const [availableYearRows, monthlyRows, billableMonthlyRows, reports] = await Promise.all([
      prisma.report.groupBy({
        by: ['year'],
        where: { custId, deletedAt: null },
        orderBy: { year: 'desc' },
      }),
      prisma.report.groupBy({
        by: ['month'],
        where: { custId, year, deletedAt: null },
        _sum: { usageSize: true, fileCount: true },
        _count: { _all: true },
        orderBy: { month: 'asc' },
      }),
      prisma.report.groupBy({
        by: ['month'],
        where: { custId, year, deletedAt: null, usageSize: billableUsageFilter() },
        _sum: { usageSize: true },
        orderBy: { month: 'asc' },
      }),
      prisma.report.findMany({
        where: { custId, year, deletedAt: null },
        select: {
          month: true,
          usageSize: true,
          fileCount: true,
          pricePerGb: true,
          folderId: true,
          folder: { select: { folderName: true, department: { select: { deptName: true } } } },
        },
      }),
    ]);

    const { months, clusters: clusterRows, workflowFolders: workflowFolderRows, totals } = buildCustomerYearlyMonths({
      year,
      monthlyRows,
      billableMonthlyRows,
      reports,
    });

    const formatSummary = (values) => values
      .map((value) => {
        const { usageBytes, ...identity } = value;
        return { ...identity, usageBytes: String(usageBytes), usageGb: bytesToGb(usageBytes) };
      })
      .sort((a, b) => b.usageGb - a.usageGb || a.cluster.localeCompare(b.cluster) || (a.workflowFolder || '').localeCompare(b.workflowFolder || ''));

    const summary = {
      customer: { custId: customer.custId, name: customer.custName },
      selectedYear: year,
      availableYears: availableYearRows.map((row) => row.year),
      totals,
      months,
      clusters: formatSummary(clusterRows),
      workflowFolders: formatSummary(workflowFolderRows),
    };
    res.json(presentCustomerYearlySummary(summary, { includeFinancials: req.user?.role !== 'customer_viewer' }));
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/report-availability
// Lists available report periods for a customer and highlights the latest month with data.
analyticsRouter.get('/report-availability', async (req, res, next) => {
  try {
    const { cust_id } = req.query;
    if (!cust_id) {
      return res.status(400).json({ error: 'cust_id is required' });
    }

    const resolvedCustId = await getEffectiveCustomerId(req);

    const reportRows = await prisma.report.findMany({
      where: { custId: resolvedCustId, deletedAt: null },
      select: { year: true, month: true, usageSize: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const periodMap = new Map();
    for (const report of reportRows) {
      const key = `${report.year}-${report.month}`;
      const period = periodMap.get(key) || { year: report.year, month: report.month, reportRows: 0, totalUsageBytes: 0n };
      period.reportRows += 1;
      period.totalUsageBytes += billableUsageBytes(report.usageSize);
      periodMap.set(key, period);
    }

    const availableMonths = [...periodMap.values()].map((period) => ({
      year: period.year,
      month: period.month,
      reportRows: period.reportRows,
      totalUsageGb: bytesToGb(period.totalUsageBytes),
    }));

    res.json({
      custId: resolvedCustId,
      latestAvailable: availableMonths[0] || null,
      availableMonths,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/report-detail
analyticsRouter.get('/report-detail', async (req, res, next) => {
  try {
    const { cust_id, month, year } = req.query;
    if (!cust_id || !month || !year) {
      return res.status(400).json({ error: 'cust_id, month, and year are required' });
    }

    const resolvedCustId = await getEffectiveCustomerId(req);

    // 1. Isilon data
    const reports = await prisma.report.findMany({
      where: { custId: resolvedCustId, month, year, deletedAt: null },
      include: {
        folder: {
          include: { department: { include: { customer: { include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } } } } } },
        },
      },
      orderBy: [
        { folder: { department: { deptName: 'asc' } } },
        { folder: { folderName: 'asc' } },
        { createdAt: 'asc' },
      ],
    });

    // Apply the threshold to each path before building folder and cluster sums.
    const workfolderMap = new Map();
    const deptMap = {};
    for (const r of reports) {
      const usageBytes = billableUsageBytes(r.usageSize);
      const workfolder = workfolderMap.get(r.folderId) || { folder: r.folder, usageBytes: 0n };
      workfolder.usageBytes += usageBytes;
      workfolderMap.set(r.folderId, workfolder);
      const deptName = r.folder.department.deptName;
      if (!deptMap[deptName]) deptMap[deptName] = 0n;
      deptMap[deptName] += usageBytes;
    }

    // 4. Breakdown data
    const breakdowns = await prisma.breakdown.findMany({
      where: { custId: resolvedCustId, month, year },
    });

    const [latestImport, pendingUnmatched, latestAvailable, lifecycle] = await Promise.all([
      prisma.importRun.findFirst({
        where: { custId: resolvedCustId, month: String(month), year: String(year) },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, fullname: true } } },
      }),
      prisma.unmatchedDirectory.count({
        where: { status: 'PENDING', importRun: { custId: resolvedCustId, month: String(month), year: String(year) } },
      }),
      prisma.report.findFirst({
        where: { custId: resolvedCustId, deletedAt: null },
        select: { year: true, month: true },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      prisma.reportPeriod.findUnique({
        where: { custId_month_year: { custId: resolvedCustId, month: String(month).padStart(2, '0'), year: String(year) } },
      }),
    ]);

    const latestAvailableReports = latestAvailable
      ? await prisma.report.findMany({
        where: { custId: resolvedCustId, year: latestAvailable.year, month: latestAvailable.month, deletedAt: null },
        select: { usageSize: true },
      })
      : [];
    const latestAvailableUsage = latestAvailableReports.reduce((sum, report) => sum + billableUsageBytes(report.usageSize), 0n);
    const reportTotalUsage = sumBillableUsageBytes(reports, (report) => report.usageSize);
    const reportTotalRevenue = reports.reduce(
      (sum, report) => sum + exactBillableUsageGb(report.usageSize) * Number(report.pricePerGb),
      0,
    );

    // Find MXFSERVER billable size for percentage calculation.
    const mxfReport = reports.find(r => r.folder.folderShortName === 'MXFSERVER');
    const mxfSize = mxfReport ? Number(billableUsageBytes(mxfReport.usageSize)) : 0;

    const customer = await prisma.customer.findUnique({
      where: { custId: resolvedCustId },
      include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    res.json({
      customer: customer ? { id: customer.custId, name: customer.custName, pricePerGb: Number(customer.prices[0]?.price || 0) } : null,
      month,
      year,
      meta: {
        status: reports.length > 0 ? (lifecycle?.status || 'DRAFT') : 'EMPTY',
        lifecycleVersion: lifecycle?.version || 1,
        rowCount: reports.length,
        breakdownRowCount: breakdowns.length,
        pendingUnmatched: req.user?.role === 'customer_viewer' ? 0 : pendingUnmatched,
        latestImport: req.user?.role === 'customer_viewer' ? null : latestImport ? {
          id: latestImport.id,
          fileName: latestImport.fileName,
          status: latestImport.status,
          matchedCount: latestImport.matchedCount,
          unmatchedCount: latestImport.unmatchedCount,
          insertedCount: latestImport.insertedCount,
          skippedCount: latestImport.skippedCount,
          createdAt: latestImport.createdAt,
          uploadedBy: latestImport.user?.fullname || latestImport.user?.username || 'Unknown',
        } : null,
        latestAvailable: latestAvailable ? {
          year: latestAvailable.year,
          month: latestAvailable.month,
          reportRows: latestAvailableReports.length,
          totalUsageGb: bytesToGb(latestAvailableUsage),
        } : null,
      },
      isilon: reports.map(r => ({
        id: r.id,
        cluster: `${r.folder.department.customer.custName} ${r.folder.department.deptName}`,
        workflowFolder: `${r.folder.department.deptName} - ${r.folder.folderName}`,
        sizeGb: bytesToGb(r.usageSize),
        sizeBytes: String(billableUsageBytes(r.usageSize)),
        fileCount: r.fileCount,
      })),
      totalUsageGb: bytesToGb(reportTotalUsage),
      totalRevenue: Math.round((reportTotalRevenue + Number.EPSILON) * 100) / 100,
      workfolderSummary: [...workfolderMap.entries()].map(([folderId, summary]) => {
        const f = summary.folder;
        return {
          folderName: f ? `${f.department.deptName} - ${f.folderName}` : folderId,
          sizeGb: bytesToGb(summary.usageBytes),
        };
      }),
      departmentalSummary: Object.entries(deptMap).map(([name, size]) => ({
        deptName: name,
        sizeGb: bytesToGb(size),
      })),
      breakdowns: breakdowns.map(b => ({
        unit: b.unit,
        usageSize: b.usageSize,
        percentage: mxfSize > 0 ? (1 - (b.usageSize / mxfSize)) * 100 : 0,
      })),
      mxfServerSizeGb: bytesToGb(mxfSize),
    });
  } catch (err) {
    next(err);
  }
});
