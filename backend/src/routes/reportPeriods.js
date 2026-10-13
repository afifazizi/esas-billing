import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, requireInternal } from '../middleware/auth.js';
import { assertPeriodReadyForTransition, normalizePeriod, planTransition, validateTransitionInput } from '../services/reportLifecycle.js';
import { runSerializableTransaction } from '../services/transaction.js';

export const reportPeriodRouter = Router();
reportPeriodRouter.use(authenticate);

function assertViewerScope(req, custId, write = false) {
  if (req.user?.role !== 'customer_viewer') return;
  if (write) {
    const error = new Error('Customer users are read-only');
    error.status = 403;
    throw error;
  }
  if (!req.user.custId || req.user.custId !== custId) {
    const error = new Error('Customer scope mismatch');
    error.status = 403;
    throw error;
  }
}

async function getCustomerOrThrow(custId) {
  const customer = await prisma.customer.findFirst({ where: { custId, deletedAt: null }, select: { custId: true, custName: true } });
  if (!customer) {
    const error = new Error('Customer not found');
    error.status = 404;
    throw error;
  }
  return customer;
}

function virtualDraft(period, customer) {
  return period || {
    id: null,
    custId: customer.custId,
    month: null,
    year: null,
    status: 'DRAFT',
    version: 1,
    reviewedById: null,
    reviewedAt: null,
    approvedById: null,
    approvedAt: null,
    lockedById: null,
    lockedAt: null,
    reopenedById: null,
    reopenedAt: null,
    reopenReason: null,
    createdAt: null,
    updatedAt: null,
  };
}

reportPeriodRouter.get('/', async (req, res, next) => {
  try {
    const input = normalizePeriod(req.query);
    assertViewerScope(req, input.custId);
    const customer = await getCustomerOrThrow(input.custId);
    const period = await prisma.reportPeriod.findUnique({ where: { custId_month_year: input } });
    res.json({ ...virtualDraft(period, customer), month: input.month, year: input.year, customer });
  } catch (error) {
    next(error);
  }
});

reportPeriodRouter.get('/history', async (req, res, next) => {
  try {
    const input = normalizePeriod(req.query);
    assertViewerScope(req, input.custId);
    await getCustomerOrThrow(input.custId);
    const period = await prisma.reportPeriod.findUnique({
      where: { custId_month_year: input },
      include: { transitions: { orderBy: { createdAt: 'asc' } } },
    });
    const actorIds = [...new Set((period?.transitions || []).map((item) => item.actorId))];
    const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true, fullname: true } }) : [];
    const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
    res.json({
      custId: input.custId,
      month: input.month,
      year: input.year,
      status: period?.status || 'DRAFT',
      version: period?.version || 1,
      history: (period?.transitions || []).map((item) => ({ ...item, actor: actorMap.get(item.actorId) || null })),
    });
  } catch (error) {
    next(error);
  }
});

async function transition(req, res, next) {
  try {
    const input = normalizePeriod({ ...req.query, ...req.body });
    assertViewerScope(req, input.custId, true);
    const { targetStatus, reason } = validateTransitionInput(req.body);
    const customer = await getCustomerOrThrow(input.custId);
    const now = new Date();

    const updated = await runSerializableTransaction(prisma, async (tx) => {
      let period = await tx.reportPeriod.findUnique({ where: { custId_month_year: input } });
      const fromStatus = period?.status || 'DRAFT';
      const changes = planTransition(period, targetStatus, req.user, reason, now);
      await assertPeriodReadyForTransition(tx, input, targetStatus);
      if (!period) {
        period = await tx.reportPeriod.create({ data: { ...input } });
      }
      const nextPeriod = await tx.reportPeriod.update({ where: { id: period.id }, data: changes });
      await tx.reportPeriodTransition.create({
        data: {
          reportPeriodId: period.id,
          fromStatus,
          toStatus: targetStatus,
          version: nextPeriod.version,
          actorId: req.user.id,
          reason,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: targetStatus === 'DRAFT' ? 'REOPEN_REPORT_PERIOD' : 'TRANSITION_REPORT_PERIOD',
          entityType: 'ReportPeriod',
          entityId: period.id,
          oldValue: JSON.stringify({ status: fromStatus, version: period.version }),
          newValue: JSON.stringify({ custId: input.custId, month: input.month, year: input.year, status: targetStatus, version: nextPeriod.version, reason }),
          ipAddress: req.ip || null,
          userAgent: req.headers?.['user-agent'] || null,
        },
      });
      return nextPeriod;
    });

    res.json({ ...updated, customer });
  } catch (error) {
    next(error);
  }
}

reportPeriodRouter.post('/transition', requireInternal, transition);
reportPeriodRouter.put('/transition', requireInternal, transition);
