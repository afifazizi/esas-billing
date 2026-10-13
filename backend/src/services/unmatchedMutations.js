import { assertPeriodMutable } from './reportLifecycle.js';
import { runSerializableTransaction } from './transaction.js';
import { billableUsageBytes } from '../utils/usageThreshold.js';

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function auditData({ actor, action, entityId, newValue }) {
  return { userId: actor.id, action, entityType: 'UnmatchedDirectory', entityId, oldValue: null, newValue: JSON.stringify(newValue), ipAddress: actor.ipAddress || null, userAgent: actor.userAgent || null };
}

export async function mapUnmatchedDirectoryTransaction(db, { directoryId, folderId, actor }) {
  return runSerializableTransaction(db, async (tx) => {
    const dir = await tx.unmatchedDirectory.findUnique({ where: { id: directoryId }, include: { importRun: true } });
    if (!dir) throw httpError(404, 'Unmatched directory not found');
    const folder = await tx.folder.findUnique({ where: { folderId }, include: { department: { include: { customer: { include: { prices: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] } } } } } } });
    if (!folder) throw httpError(404, 'Folder not found');
    const importRun = dir.importRun;
    if (!importRun) throw httpError(404, 'Import run not found');
    const custId = importRun.custId || folder.department.custId;
    if (importRun.custId && folder.department.custId !== importRun.custId) throw httpError(409, 'Mapped folder belongs to a different customer than the import run');
    await assertPeriodMutable(tx, { custId, month: importRun.month, year: importRun.year });
    const selectedPrice = folder.department.customer.prices?.find((price) => price.isDefault) || folder.department.customer.prices?.[0] || null;
    const duplicate = await tx.report.findFirst({ where: { folderId, month: importRun.month, year: importRun.year, fileHash: importRun.fileHash, deletedAt: null } });
    let report = duplicate;
    if (!report) {
      report = await tx.report.create({ data: {
        folderId, usageSize: billableUsageBytes(dir.sizeBytes), month: importRun.month, year: importRun.year,
        pricePerGb: selectedPrice?.price || 0, priceId: selectedPrice?.id || null, fileHash: importRun.fileHash,
        fileName: importRun.fileName.replace(/\.csv$/i, ''), folderDir: dir.directoryPath, dirCount: 0,
        fileCount: dir.fileCount, adsCount: 0, otherCount: 0, custId,
      } });
    }
    const updated = await tx.unmatchedDirectory.update({ where: { id: directoryId }, data: { mappedFolderId: folderId, status: 'RESOLVED' } });
    if (!duplicate) await tx.importRun.update({ where: { id: importRun.id }, data: { matchedCount: { increment: 1 }, insertedCount: { increment: 1 }, unmatchedCount: { decrement: importRun.unmatchedCount > 0 ? 1 : 0 }, status: importRun.unmatchedCount <= 1 ? 'SUCCESS' : importRun.status } });
    await tx.auditLog.create({ data: auditData({ actor, action: 'MAP_UNMATCHED_DIRECTORY', entityId: directoryId, newValue: { folderId, reportId: report.id, createdReport: !duplicate } }) });
    return { updated, report, createdReport: !duplicate };
  });
}

export async function ignoreUnmatchedDirectoryTransaction(db, { directoryId, actor }) {
  return runSerializableTransaction(db, async (tx) => {
    const dir = await tx.unmatchedDirectory.findUnique({ where: { id: directoryId }, include: { importRun: true } });
    if (!dir) throw httpError(404, 'Unmatched directory not found');
    if (!dir.importRun?.custId) throw httpError(409, 'Import run customer is required to change readiness');
    await assertPeriodMutable(tx, { custId: dir.importRun.custId, month: dir.importRun.month, year: dir.importRun.year });
    const updated = await tx.unmatchedDirectory.update({ where: { id: directoryId }, data: { status: 'IGNORED' } });
    await tx.auditLog.create({ data: auditData({ actor, action: 'IGNORE_UNMATCHED_DIRECTORY', entityId: directoryId, newValue: { status: 'IGNORED' } }) });
    return updated;
  });
}
