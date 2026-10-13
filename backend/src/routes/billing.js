import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, requireInternal } from '../middleware/auth.js';
import { normalizePeriod } from '../services/reportLifecycle.js';
import { buildBillingCustomerSummary } from '../services/billingSummary.js';
import { BYTES_PER_GB } from '../utils/usageThreshold.js';

export const billingRouter = Router();
billingRouter.use(authenticate, requireInternal);

billingRouter.get('/summary', async (req, res, next) => {
  try {
    const { month, year } = normalizePeriod({ custId: '_validation_', month: req.query.month, year: req.query.year });
    const [customers, reports, periods, imports, pendingDirectories] = await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null },
        select: {
          custId: true,
          custName: true,
          prices: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
        },
        orderBy: { custName: 'asc' },
      }),
      prisma.report.findMany({
        where: { month, year, deletedAt: null },
        select: { custId: true, usageSize: true, pricePerGb: true, priceId: true },
      }),
      prisma.reportPeriod.findMany({ where: { month, year } }),
      prisma.importRun.findMany({ where: { month, year }, orderBy: { createdAt: 'desc' } }),
      prisma.unmatchedDirectory.findMany({
        where: { status: 'PENDING', importRun: { month, year } },
        select: { importRun: { select: { custId: true } } },
      }),
    ]);

    const byCustomer = (rows, key = 'custId') => rows.reduce((map, row) => {
      const id = row[key];
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
      return map;
    }, new Map());
    const reportMap = byCustomer(reports);
    const importMap = byCustomer(imports);
    const periodMap = new Map(periods.map((period) => [period.custId, period]));
    const pendingMap = new Map();
    for (const row of pendingDirectories) {
      const id = row.importRun.custId;
      if (id) pendingMap.set(id, (pendingMap.get(id) || 0) + 1);
    }

    const data = customers.map((customer) => buildBillingCustomerSummary({
      customer,
      reports: reportMap.get(customer.custId) || [],
      period: periodMap.get(customer.custId) || null,
      imports: importMap.get(customer.custId) || [],
      pendingUnmatched: pendingMap.get(customer.custId) || 0,
      month,
      year,
    }));
    const statusCounts = { DRAFT: 0, REVIEWED: 0, APPROVED: 0, LOCKED: 0 };
    for (const item of data) statusCounts[item.lifecycleStatus] = (statusCounts[item.lifecycleStatus] || 0) + 1;
    const totals = data.reduce((acc, item) => {
      acc.customerCount += 1;
      acc.reportRowCount += item.reportRowCount;
      acc.usageBytes = String(BigInt(acc.usageBytes) + BigInt(item.usageBytes));
      acc.revenue += item.revenue;
      acc.pendingUnmatchedCount += item.pendingUnmatchedCount;
      if (item.readiness.ready) acc.readyCount += 1;
      return acc;
    }, { customerCount: 0, reportRowCount: 0, usageBytes: '0', revenue: 0, pendingUnmatchedCount: 0, readyCount: 0 });
    totals.usageGb = Number((Number(totals.usageBytes) / Number(BYTES_PER_GB)).toFixed(3));
    totals.revenue = Math.round((totals.revenue + Number.EPSILON) * 100) / 100;

    res.json({ month, year, customers: data, totals, statusCounts });
  } catch (error) {
    next(error);
  }
});
