import { assertPeriodMutable } from './reportLifecycle.js';
import { runSerializableTransaction } from './transaction.js';
import { billableUsageBytes } from '../utils/usageThreshold.js';

function notFound(message) { const error = new Error(message); error.status = 404; return error; }
function badRequest(message) { const error = new Error(message); error.status = 400; return error; }

function auditData({ actor, action, entityType, entityId, oldValue = null, newValue = null }) {
  return {
    userId: actor.id,
    action,
    entityType,
    entityId,
    oldValue: oldValue == null ? null : JSON.stringify(oldValue),
    newValue: newValue == null ? null : JSON.stringify(newValue),
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null,
  };
}

export async function commitUploadPreviewTransaction(db, { preview, actor }) {
  return runSerializableTransaction(db, async (tx) => {
    await assertPeriodMutable(tx, preview);
    let insertedCount = 0;
    let skippedCount = Number(preview.skippedCount || 0) + Number(preview.duplicateCount || 0);
    for (const row of preview.matchedRows || []) {
      const duplicate = await tx.report.findFirst({ where: { folderId: row.folderId, month: preview.month, year: preview.year, fileHash: preview.fileHash, deletedAt: null } });
      if (duplicate) { skippedCount += 1; continue; }
      await tx.report.create({ data: {
        folderId: row.folderId, usageSize: billableUsageBytes(row.sizeBytes), month: preview.month, year: preview.year,
        pricePerGb: row.pricePerGb, priceId: row.priceId || preview.priceId || null, fileHash: preview.fileHash,
        fileName: preview.fileName.replace(/\.csv$/i, ''), folderDir: row.directoryPath, dirCount: row.dirCount,
        fileCount: row.fileCount, adsCount: row.adsCount, otherCount: row.otherCount, custId: preview.custId,
      } });
      insertedCount += 1;
    }
    const importRun = await tx.importRun.create({ data: {
      userId: actor.id, fileName: preview.fileName, fileHash: preview.fileHash, month: preview.month, year: preview.year, custId: preview.custId,
      matchedCount: Number(preview.matchedCount || 0), unmatchedCount: Number(preview.unmatchedCount || 0), insertedCount, skippedCount,
      status: Number(preview.unmatchedCount || 0) > 0 ? 'PARTIAL' : 'SUCCESS',
    } });
    for (const row of preview.unmatchedRows || []) {
      await tx.unmatchedDirectory.create({ data: { importRunId: importRun.id, directoryPath: row.directoryPath, sizeBytes: billableUsageBytes(row.sizeBytes), fileCount: row.fileCount, status: 'PENDING' } });
    }
    await tx.auditLog.create({ data: auditData({ actor, action: 'UPLOAD_REPORT', entityType: 'ImportRun', entityId: importRun.id, newValue: { fileName: preview.fileName, custId: preview.custId, month: preview.month, year: preview.year, inserted: insertedCount, skipped: skippedCount } }) });
    return { importRun, insertedCount, skippedCount };
  });
}

export async function repriceReportsTransaction(db, { custId, month, year, priceId, actor }) {
  return runSerializableTransaction(db, async (tx) => {
    await assertPeriodMutable(tx, { custId, month, year });
    const tier = await tx.price.findUnique({ where: { id: priceId } });
    if (!tier) throw notFound('Price tier not found');
    if (tier.custId !== custId) throw badRequest('Price tier does not belong to this customer');
    const result = await tx.report.updateMany({ where: { custId, month, year, deletedAt: null }, data: { pricePerGb: tier.price, priceId: tier.id } });
    await tx.auditLog.create({ data: auditData({ actor, action: 'REPRICE_REPORTS', entityType: 'Report', entityId: custId, newValue: { custId, month, year, priceId, pricePerGb: tier.price, updated: result.count } }) });
    return { updated: result.count, pricePerGb: tier.price, priceLabel: tier.label || '' };
  });
}

export async function softDeleteReportTransaction(db, { reportId, actor }) {
  return runSerializableTransaction(db, async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('Report not found');
    await assertPeriodMutable(tx, report);
    const updated = await tx.report.update({ where: { id: reportId }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({ data: auditData({ actor, action: 'SOFT_DELETE_REPORT', entityType: 'Report', entityId: reportId, oldValue: { custId: report.custId, month: report.month, year: report.year } }) });
    return updated;
  });
}
