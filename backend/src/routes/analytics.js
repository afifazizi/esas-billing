import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.use((req, res, next) => {
  if (req.user?.role !== 'customer_viewer') return next();
  const allowed = req.method === 'GET' && ['/report-availability', '/report-detail', '/customer-usage-comparison'].includes(req.path);
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
  return Math.ceil(Number(bytes || 0n) / 1073741824);
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
        where: { deletedAt: null, month, year },
      }),
      prisma.report.findMany({
        where: { deletedAt: null, month, year },
        select: { usageSize: true, pricePerGb: true },
      }),
      prisma.report.count({ where: { deletedAt: null, month, year } }),
    ]);

    const totalUsageBytes = usageResult._sum.usageSize || 0n;
    const totalUsageGB = Math.ceil(Number(totalUsageBytes) / 1073741824);
    const totalUsageTB = (Number(totalUsageBytes) / 1099511627776).toFixed(2);

    const totalRevenue = revenueResult.reduce((sum, r) => {
      return sum + (Number(r.usageSize) / 1073741824) * Number(r.pricePerGb);
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
        where: { year, deletedAt: null },
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
      const totalUsage = reports.reduce((sum, r) => sum + Number(r.usageSize), 0);
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
        where: { year, month: m, deletedAt: null },
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
    return sum + (Number(r.usageSize || 0n) / 1073741824) * Number(r.pricePerGb || 0);
  }, 0);
}

function monthLimitForYear(year) {
  const now = new Date();
  const currentYear = String(now.getFullYear());
  if (year === currentYear) return now.getMonth() + 1;
  return 12;
}

async function getYearReportFacts(year) {
  const [totalCustomers, usageResult, reports, reportMonths, importRuns, pendingUnmatched] = await Promise.all([
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.report.aggregate({
      _sum: { usageSize: true },
      where: { deletedAt: null, year },
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
  ]);

  const activeCustomerIds = new Set(reports.map((r) => r.custId));
  const monthLimit = monthLimitForYear(year);
  const expectedReports = totalCustomers * monthLimit;
  const uploadedReports = reportMonths.length;
  const totalUsageBytes = usageResult._sum.usageSize || 0n;
  const totalRevenue = revenueFromReports(reports);
  const partialImports = importRuns.filter((run) => run.status === 'PARTIAL').length;
  const failedImports = importRuns.filter((run) => run.status === 'FAILED').length;

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
      where: { deletedAt: null, year },
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
      where: { deletedAt: null, year },
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
        href: '/dashboard/unmatched-directories',
      });
    }

    if (facts.partialImports > 0) {
      items.push({
        key: 'partial-imports',
        severity: 'warning',
        title: 'Partial imports this year',
        description: `${facts.partialImports} upload run${facts.partialImports === 1 ? '' : 's'} completed with unmatched data.`,
        count: facts.partialImports,
        href: '/dashboard/import-runs',
      });
    }

    if (facts.failedImports > 0) {
      items.push({
        key: 'failed-imports',
        severity: 'critical',
        title: 'Failed imports this year',
        description: `${facts.failedImports} upload run${facts.failedImports === 1 ? '' : 's'} failed and should be investigated.`,
        count: facts.failedImports,
        href: '/dashboard/import-runs',
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
        href: '/dashboard/reports',
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
      const sizeGb = bytesToGb(report.usageSize);
      const usageBytes = BigInt(report.usageSize || 0n);
      period.totalUsageBytes = String(BigInt(period.totalUsageBytes) + usageBytes);
      period.totalUsageGb += sizeGb;
      period.totalFileCount += report.fileCount || 0;
      period.reportRows += 1;

      const cluster = report.folder.department.deptName;
      const workflowFolder = `${cluster} - ${report.folder.folderName}`;
      const folderRow = {
        folderId: report.folderId,
        cluster,
        workflowFolder,
        usageBytes: String(report.usageSize),
        usageGb: sizeGb,
        fileCount: report.fileCount || 0,
      };
      period.folders.push(folderRow);

      const clusterKey = cluster;
      if (!clusterMap.has(clusterKey)) clusterMap.set(clusterKey, { cluster, periods: Object.fromEntries(periodKeys.map((k) => [k, { usageGb: 0, fileCount: 0 }])) });
      clusterMap.get(clusterKey).periods[key].usageGb += sizeGb;
      clusterMap.get(clusterKey).periods[key].fileCount += report.fileCount || 0;

      const folderKey = `${cluster}||${workflowFolder}`;
      if (!folderMap.has(folderKey)) folderMap.set(folderKey, { cluster, workflowFolder, periods: Object.fromEntries(periodKeys.map((k) => [k, { usageGb: 0, fileCount: 0 }])) });
      folderMap.get(folderKey).periods[key].usageGb += sizeGb;
      folderMap.get(folderKey).periods[key].fileCount += report.fileCount || 0;
    }

    for (const period of byPeriod.values()) {
      period.folders.sort((a, b) => a.cluster.localeCompare(b.cluster) || a.workflowFolder.localeCompare(b.workflowFolder));
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

// GET /api/analytics/report-availability
// Lists available report periods for a customer and highlights the latest month with data.
analyticsRouter.get('/report-availability', async (req, res, next) => {
  try {
    const { cust_id } = req.query;
    if (!cust_id) {
      return res.status(400).json({ error: 'cust_id is required' });
    }

    const resolvedCustId = await getEffectiveCustomerId(req);

    const periods = await prisma.report.groupBy({
      by: ['year', 'month'],
      where: { custId: resolvedCustId, deletedAt: null },
      _count: { _all: true },
      _sum: { usageSize: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const availableMonths = periods.map((period) => ({
      year: period.year,
      month: period.month,
      reportRows: period._count._all,
      totalUsageGb: bytesToGb(period._sum.usageSize || 0n),
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

    // 2. Workfolder summary (grouped by folder)
    const workfolderSummary = await prisma.report.groupBy({
      by: ['folderId'],
      where: { custId: resolvedCustId, month, year, deletedAt: null },
      _sum: { usageSize: true },
    });

    const folderIds = workfolderSummary.map(w => w.folderId);
    const folders = await prisma.folder.findMany({
      where: { folderId: { in: folderIds } },
      include: { department: { include: { customer: true } } },
    });

    // 3. Departmental summary
    const deptSummary = await prisma.report.findMany({
      where: { custId: resolvedCustId, month, year, deletedAt: null },
      include: { folder: { include: { department: true } } },
    });

    const deptMap = {};
    for (const r of deptSummary) {
      const deptName = r.folder.department.deptName;
      if (!deptMap[deptName]) deptMap[deptName] = 0n;
      deptMap[deptName] += r.usageSize;
    }

    // 4. Breakdown data
    const breakdowns = await prisma.breakdown.findMany({
      where: { custId: resolvedCustId, month, year },
    });

    const [latestImport, pendingUnmatched, latestAvailable] = await Promise.all([
      prisma.importRun.findFirst({
        where: { custId: resolvedCustId, month: String(month), year: String(year) },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, fullname: true } } },
      }),
      prisma.unmatchedDirectory.count({
        where: { status: 'PENDING', importRun: { custId: resolvedCustId, month: String(month), year: String(year) } },
      }),
      prisma.report.groupBy({
        by: ['year', 'month'],
        where: { custId: resolvedCustId, deletedAt: null },
        _count: { _all: true },
        _sum: { usageSize: true },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 1,
      }),
    ]);

    // Find MXFSERVER size for percentage calculation
    const mxfReport = reports.find(r => r.folder.folderShortName === 'MXFSERVER');
    const mxfSize = mxfReport ? Number(mxfReport.usageSize) : 0;

    const customer = await prisma.customer.findUnique({
      where: { custId: resolvedCustId },
      include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    res.json({
      customer: customer ? { id: customer.custId, name: customer.custName, pricePerGb: Number(customer.prices[0]?.price || 0) } : null,
      month,
      year,
      meta: {
        status: reports.length > 0 ? 'DRAFT' : 'EMPTY',
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
        latestAvailable: latestAvailable[0] ? {
          year: latestAvailable[0].year,
          month: latestAvailable[0].month,
          reportRows: latestAvailable[0]._count._all,
          totalUsageGb: bytesToGb(latestAvailable[0]._sum.usageSize || 0n),
        } : null,
      },
      isilon: reports.map(r => ({
        id: r.id,
        cluster: `${r.folder.department.customer.custName} ${r.folder.department.deptName}`,
        workflowFolder: `${r.folder.department.deptName} - ${r.folder.folderName}`,
        sizeGb: Math.ceil(Number(r.usageSize) / 1073741824),
        sizeBytes: String(r.usageSize),
        fileCount: r.fileCount,
      })),
      totalUsageGb: reports.reduce((s, r) => s + Math.ceil(Number(r.usageSize) / 1073741824), 0),
      workfolderSummary: workfolderSummary.map(w => {
        const f = folders.find(fd => fd.folderId === w.folderId);
        return {
          folderName: f ? `${f.department.deptName} - ${f.folderName}` : w.folderId,
          sizeGb: Math.ceil(Number(w._sum.usageSize) / 1073741824),
        };
      }),
      departmentalSummary: Object.entries(deptMap).map(([name, size]) => ({
        deptName: name,
        sizeGb: Math.ceil(Number(size) / 1073741824),
      })),
      breakdowns: breakdowns.map(b => ({
        unit: b.unit,
        usageSize: b.usageSize,
        percentage: mxfSize > 0 ? (1 - (b.usageSize / mxfSize)) * 100 : 0,
      })),
      mxfServerSizeGb: mxfSize > 0 ? Math.ceil(mxfSize / 1073741824) : 0,
    });
  } catch (err) {
    next(err);
  }
});
