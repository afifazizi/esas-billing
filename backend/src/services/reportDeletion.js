import { assertPeriodMutable, normalizePeriod } from './reportLifecycle.js';
import { runSerializableTransaction } from './transaction.js';

const MAX_BULK_DELETE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function validateBulkDeleteInput(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'Request body must be a JSON object');
  }
  if (!Array.isArray(body.reportIds) || body.reportIds.length === 0) {
    throw httpError(400, 'Select at least one report row');
  }
  if (body.reportIds.length > MAX_BULK_DELETE) {
    throw httpError(400, `Select no more than ${MAX_BULK_DELETE} report rows`);
  }

  const reportIds = [...new Set(body.reportIds.map((id) => String(id).trim()))];
  if (reportIds.some((id) => !UUID_PATTERN.test(id))) {
    throw httpError(400, 'Every reportId must be a valid UUID');
  }

  return { reportIds, ...normalizePeriod(body) };
}

export async function softDeleteReports(db, input) {
  const reportIds = [...new Set((input.reportIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (reportIds.length === 0) throw httpError(400, 'Select at least one report row');
  if (reportIds.length > MAX_BULK_DELETE) throw httpError(400, `Select no more than ${MAX_BULK_DELETE} report rows`);
  if (!input.actorId) throw httpError(401, 'Authenticated user is required');

  const period = normalizePeriod(input);
  const deletedAt = input.now || new Date();

  return runSerializableTransaction(db, async (tx) => {
    const reports = await tx.report.findMany({
      where: { id: { in: reportIds }, deletedAt: null },
      select: { id: true, custId: true, month: true, year: true },
    });

    const exactPeriod = reports.length === reportIds.length && reports.every((report) => (
      report.custId === period.custId
      && report.month === period.month
      && report.year === period.year
    ));
    if (!exactPeriod) {
      throw httpError(409, 'One or more selected rows are missing or belong to a different report period. Refresh and select again.');
    }

    await assertPeriodMutable(tx, period);

    const result = await tx.report.updateMany({
      where: {
        id: { in: reportIds },
        custId: period.custId,
        month: period.month,
        year: period.year,
        deletedAt: null,
      },
      data: { deletedAt },
    });
    if (result.count !== reportIds.length) {
      throw httpError(409, 'The selected rows changed before deletion. Refresh and select again.');
    }

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: 'BULK_DELETE_REPORTS',
        entityType: 'ReportPeriod',
        entityId: `${period.custId}:${period.year}-${period.month}`,
        oldValue: null,
        newValue: JSON.stringify({
          ...period,
          deletedCount: result.count,
          reportIds,
        }),
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      },
    });

    return { deleted: result.count, reportIds };
  });
}

export { MAX_BULK_DELETE };
