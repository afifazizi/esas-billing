const STATUSES = Object.freeze(['DRAFT', 'REVIEWED', 'APPROVED', 'LOCKED']);
const ADMIN_ONLY_TARGETS = new Set(['APPROVED', 'LOCKED', 'DRAFT']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizePeriod({ custId, month, year }) {
  const normalized = {
    custId: String(custId || '').trim(),
    month: String(month || '').padStart(2, '0'),
    year: String(year || ''),
  };
  if (!normalized.custId) throw httpError(400, 'custId is required');
  if (!/^(0[1-9]|1[0-2])$/.test(normalized.month)) throw httpError(400, 'month must be between 01 and 12');
  if (!/^\d{4}$/.test(normalized.year)) throw httpError(400, 'year must be a four-digit year');
  return normalized;
}

export function validateTransitionInput(body = {}) {
  const targetStatus = String(body.status || body.targetStatus || '').toUpperCase();
  if (!STATUSES.includes(targetStatus)) throw httpError(400, `status must be one of ${STATUSES.join(', ')}`);
  const reason = body.reason == null ? null : String(body.reason).trim();
  if (reason && reason.length > 1000) throw httpError(400, 'reason must be 1000 characters or fewer');
  return { targetStatus, reason: reason || null };
}

export function planTransition(period, targetStatus, actor, reason = null, now = new Date()) {
  const fromStatus = period?.status || 'DRAFT';
  const version = period?.version || 1;
  if (!actor?.id) throw httpError(401, 'Authenticated user is required');
  if (actor.role === 'customer_viewer') throw httpError(403, 'Customer users are read-only');

  const allowedForward = { DRAFT: 'REVIEWED', REVIEWED: 'APPROVED', APPROVED: 'LOCKED' };
  const reopening = targetStatus === 'DRAFT' && fromStatus !== 'DRAFT';
  if (!reopening && allowedForward[fromStatus] !== targetStatus) {
    throw httpError(409, `Invalid report lifecycle transition: ${fromStatus} -> ${targetStatus}`);
  }
  if ((ADMIN_ONLY_TARGETS.has(targetStatus) || reopening) && actor.role !== 'admin') {
    throw httpError(403, 'Admin access required for this transition');
  }
  if (reopening && !String(reason || '').trim()) throw httpError(400, 'A reason is required to reopen a report period');

  const change = { status: targetStatus, version };
  if (targetStatus === 'REVIEWED') Object.assign(change, { reviewedById: actor.id, reviewedAt: now });
  if (targetStatus === 'APPROVED') Object.assign(change, { approvedById: actor.id, approvedAt: now });
  if (targetStatus === 'LOCKED') Object.assign(change, { lockedById: actor.id, lockedAt: now });
  if (reopening) Object.assign(change, {
    version: version + 1,
    reopenedById: actor.id,
    reopenedAt: now,
    reopenReason: String(reason).trim(),
    reviewedById: null,
    reviewedAt: null,
    approvedById: null,
    approvedAt: null,
    lockedById: null,
    lockedAt: null,
  });
  return change;
}

export function assertMutablePeriod(period) {
  if (period && ['APPROVED', 'LOCKED'].includes(period.status)) {
    throw httpError(409, `Report period is ${period.status} and cannot be modified. Reopen it to DRAFT first.`);
  }
}

export async function assertPeriodMutable(db, input) {
  const period = normalizePeriod(input);
  const lifecycle = await db.reportPeriod.findUnique({
    where: { custId_month_year: period },
    select: { id: true, status: true },
  });
  assertMutablePeriod(lifecycle);
  return lifecycle;
}

export async function assertPeriodReadyForTransition(db, input, targetStatus) {
  if (!['APPROVED', 'LOCKED'].includes(targetStatus)) return;
  const period = normalizePeriod(input);
  const [folders, reports, pendingUnmatched, latestImport, prices] = await Promise.all([
    db.folder.findMany({ where: { department: { custId: period.custId }, deletedAt: null }, select: { folderId: true } }),
    db.report.findMany({ where: { ...period, deletedAt: null }, select: { folderId: true, priceId: true, pricePerGb: true } }),
    db.unmatchedDirectory.count({ where: { status: 'PENDING', importRun: period } }),
    db.importRun.findFirst({ where: period, orderBy: { createdAt: 'desc' }, select: { status: true } }),
    db.price.findMany({ where: { custId: period.custId }, select: { id: true, price: true } }),
  ]);

  if (reports.length === 0) throw httpError(409, 'Report period is not ready: no report rows exist');
  const receivedFolderIds = new Set(reports.map((report) => report.folderId));
  const missing = folders.filter((folder) => !receivedFolderIds.has(folder.folderId));
  if (missing.length > 0) throw httpError(409, `Report period is not ready: ${missing.length} missing configured folder path${missing.length === 1 ? '' : 's'}`);
  if (pendingUnmatched > 0) throw httpError(409, `Report period is not ready: ${pendingUnmatched} unmatched path blocker${pendingUnmatched === 1 ? '' : 's'}`);
  if (latestImport && ['FAILED', 'PARTIAL'].includes(latestImport.status)) throw httpError(409, `Report period is not ready: latest import status is ${latestImport.status}`);
  const validPriceIds = new Set(prices.filter((price) => Number.isFinite(Number(price.price)) && Number(price.price) > 0).map((price) => price.id));
  if (!prices.length || reports.some((report) => !validPriceIds.has(report.priceId) || !Number.isFinite(Number(report.pricePerGb)) || Number(report.pricePerGb) <= 0)) {
    throw httpError(409, 'Report period is not ready: every report row must have a valid configured price');
  }
}

export { STATUSES };
