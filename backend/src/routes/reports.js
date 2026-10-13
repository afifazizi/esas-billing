import { Router } from 'express';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import os from 'os';
import path from 'path';
import prisma from '../db.js';
import { authenticate, requireInternal } from '../middleware/auth.js';
import { uploadCsv } from '../middleware/upload.js';
import { z } from 'zod';
import { assertPeriodMutable } from '../services/reportLifecycle.js';
import { softDeleteReports, validateBulkDeleteInput } from '../services/reportDeletion.js';
import { commitUploadPreviewTransaction, repriceReportsTransaction, softDeleteReportTransaction } from '../services/reportMutations.js';
import { createPreviewStore } from '../services/uploadPreviewStore.js';
import { billableUsageBytes, billableUsageGb } from '../utils/usageThreshold.js';

export const reportRouter = Router();
reportRouter.use(authenticate);

const PREVIEW_DIR = path.join(os.tmpdir(), 'esas-upload-previews');
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const previewStore = createPreviewStore({ directory: PREVIEW_DIR, ttlMs: PREVIEW_TTL_MS });

function parseReportParams(body) {
  const custId = body.paramCustID || body.custId;
  const [dateYear, dateMonth] = String(body.reportDate || '').split('-');
  const year = String(body.year || dateYear || '');
  const month = String(body.month || dateMonth || '').padStart(2, '0');

  if (!custId) {
    const err = new Error('paramCustID or custId is required');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}$/.test(year)) {
    const err = new Error('year must be a four-digit year');
    err.status = 400;
    throw err;
  }
  if (!/^(0[1-9]|1[0-2])$/.test(month)) {
    const err = new Error('month must be between 01 and 12');
    err.status = 400;
    throw err;
  }

  return { custId, year, month, reportDate: `${year}-${month}` };
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBigIntSafe(value) {
  const raw = String(value ?? '0').trim().replace(/,/g, '');
  if (!raw) return 0n;

  const match = raw.match(/^\+?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) {
    const normalized = raw.replace(/[^0-9]/g, '');
    return normalized ? BigInt(normalized) : 0n;
  }

  const [, integerPart, fractionalPart = '', exponentPart = '0'] = match;
  const exponent = Number.parseInt(exponentPart, 10);
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+/, '') || '0';
  const decimalPlaces = fractionalPart.length - exponent;

  if (decimalPlaces <= 0) return BigInt(`${digits}${'0'.repeat(Math.abs(decimalPlaces))}`);
  if (decimalPlaces >= digits.length) return 0n;
  return BigInt(digits.slice(0, digits.length - decimalPlaces));
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

function findColumn(header, needle) {
  return header.findIndex((h) => String(h).trim().toLowerCase().includes(needle));
}

async function buildUploadPreview({ filePath, originalName, body, creatorUserId }) {
  const { custId, year, month } = parseReportParams(body);
  await assertPeriodMutable(prisma, { custId, month, year });
  const priceId = body.priceId || body.price_id || null;
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const fileHash = crypto.createHash('sha1').update(fileContent).digest('hex');
  const errors = [];
  const warnings = [];
  const rows = [];
  const matchedRows = [];
  const unmatchedRows = [];

  const records = parse(fileContent, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length < 2) {
    errors.push('CSV file is empty or has only headers');
  }

  const header = records[0] || [];
  const colPhysCount = findColumn(header, 'phys_size_sum');
  const colDirCount = findColumn(header, 'dir_cnt');
  const colFileCount = findColumn(header, 'file_cnt');
  const colAdsCount = findColumn(header, 'ads_cnt');
  const colOtherCount = findColumn(header, 'other_cnt');

  if (colPhysCount < 0) {
    errors.push('CSV must contain "phys_size_sum (bytes)" column');
  }

  let skippedCount = 0;
  let duplicateCount = 0;
  let belowThresholdCount = 0;
  let estimatedBytes = 0n;
  let resolvedPriceId = null;

  if (errors.length === 0) {
    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 1;
      if (!row[0]) {
        skippedCount++;
        rows.push({ rowNumber, status: 'skipped', message: 'Missing directory path' });
        continue;
      }

      const directoryPath = String(row[0]).trim();
      const folderShortName = directoryPath.substring(directoryPath.lastIndexOf('/') + 1);
      const rawSizeBytes = parseBigIntSafe(row[colPhysCount]);
      const sizeBytes = billableUsageBytes(rawSizeBytes);
      if (rawSizeBytes > 0n && sizeBytes === 0n) belowThresholdCount++;
      const dirCount = parseIntSafe(row[colDirCount]);
      const fileCount = parseIntSafe(row[colFileCount]);
      const adsCount = parseIntSafe(row[colAdsCount]);
      const otherCount = parseIntSafe(row[colOtherCount]);
      estimatedBytes += sizeBytes;

      const baseRow = {
        rowNumber,
        directoryPath,
        usageGb: billableUsageGb(sizeBytes),
      };

      const candidateFolders = await prisma.folder.findMany({
        where: {
          department: { custId },
          deletedAt: null,
        },
        include: {
          department: {
            include: {
              customer: {
                include: { prices: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] } },
              },
            },
          },
        },
      });
      const directoryPathLower = directoryPath.toLowerCase();
      const folderShortNameLower = folderShortName.toLowerCase();
      const folder =
        candidateFolders.find((candidate) => candidate.folderDirectory === directoryPath) ||
        candidateFolders.find((candidate) => candidate.folderDirectory.toLowerCase() === directoryPathLower) ||
        candidateFolders.find((candidate) => candidate.folderShortName === folderShortName) ||
        candidateFolders.find((candidate) => candidate.folderShortName?.toLowerCase() === folderShortNameLower);

      if (!folder) {
        unmatchedRows.push({ directoryPath, sizeBytes: String(sizeBytes), fileCount: fileCount > 0 ? fileCount : 1 });
        rows.push({ ...baseRow, status: 'unmatched', message: `No folder matched short name "${folderShortName}"` });
        continue;
      }

      const prices = folder.department.customer.prices || [];
      const selectedPrice = priceId
        ? prices.find(p => p.id === priceId)
        : prices.find(p => p.isDefault) || prices[0];
      resolvedPriceId = selectedPrice?.id || null;
      const resolvedPricePerGb = selectedPrice?.price || 0;

      const existingReport = await prisma.report.findFirst({
        where: {
          folderId: folder.folderId,
          month,
          year,
          fileHash,
          deletedAt: null,
        },
      });

      if (existingReport) {
        duplicateCount++;
        rows.push({
          ...baseRow,
          folderName: folder.folderName,
          department: folder.department.deptName,
          status: 'duplicate',
          message: 'A report row for this folder/month/year/file already exists and will be skipped',
        });
        continue;
      }

      matchedRows.push({
        folderId: folder.folderId,
        folderName: folder.folderName,
        department: folder.department.deptName,
        directoryPath,
        sizeBytes: String(sizeBytes),
        dirCount: Number.isNaN(dirCount) ? 0 : dirCount,
        fileCount: Number.isNaN(fileCount) ? 0 : fileCount,
        adsCount: Number.isNaN(adsCount) ? 0 : adsCount,
        otherCount: Number.isNaN(otherCount) ? 0 : otherCount,
        pricePerGb: resolvedPricePerGb,
      });
      rows.push({
        ...baseRow,
        folderName: folder.folderName,
        department: folder.department.deptName,
        status: 'matched',
        message: 'Ready to import',
      });
    }
  }

  if (unmatchedRows.length > 0) warnings.push(`${unmatchedRows.length} unmatched paths will be queued for review.`);
  if (duplicateCount > 0) warnings.push(`${duplicateCount} duplicate rows will be skipped.`);
  if (skippedCount > 0) warnings.push(`${skippedCount} rows were skipped before matching.`);
  if (belowThresholdCount > 0) warnings.push(`${belowThresholdCount} path${belowThresholdCount === 1 ? '' : 's'} at or below 1 GB will be recorded as 0 usage.`);

  return previewStore.save({
    fileHash,
    fileName: originalName,
    month,
    year,
    custId,
    priceId: resolvedPriceId || undefined,
    totalRows: Math.max(records.length - 1, 0),
    matchedCount: matchedRows.length,
    unmatchedCount: unmatchedRows.length,
    skippedCount,
    duplicateCount,
    belowThresholdCount,
    estimatedUsageBytes: String(estimatedBytes),
    estimatedUsageGb: billableUsageGb(estimatedBytes),
    errors,
    warnings,
    rows: rows.slice(0, 100),
    matchedRows,
    unmatchedRows,
  }, creatorUserId);
}

async function commitUploadPreview(preview, req) {
  if (preview.errors?.length) {
    const err = new Error('Preview contains validation errors. Fix the CSV and generate a new preview.');
    err.status = 400;
    throw err;
  }
  const { importRun, insertedCount, skippedCount } = await commitUploadPreviewTransaction(prisma, {
    preview,
    actor: { id: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
  });
  return {
    message: 'CSV import confirmed',
    importRunId: importRun.id,
    processed: Number(preview.matchedCount || 0),
    matchedCount: Number(preview.matchedCount || 0),
    unmatched: Number(preview.unmatchedCount || 0),
    unmatchedCount: Number(preview.unmatchedCount || 0),
    inserted: insertedCount,
    insertedCount,
    skipped: skippedCount,
    skippedCount,
    fileHash: preview.fileHash,
  };
}

// ─── Isilon CSV Upload Wizard ───
// POST /api/reports/upload/preview — parse only, no DB writes
reportRouter.post('/upload/preview', requireInternal, uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }
    const preview = await buildUploadPreview({
      filePath: req.file.path,
      originalName: req.file.originalname,
      body: req.body,
      creatorUserId: req.user.id,
    });
    fs.unlinkSync(req.file.path);
    res.json(preview);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// POST /api/reports/upload/confirm — commit a previously reviewed preview
reportRouter.post('/upload/confirm', requireInternal, async (req, res, next) => {
  try {
    const { previewId, fileHash, custId, paramCustID, month, year } = req.body;
    if (!previewId) return res.status(400).json({ error: 'previewId is required' });

    const preview = previewStore.load(previewId, req.user.id);
    if (fileHash && fileHash !== preview.fileHash) return res.status(409).json({ error: 'Preview file hash mismatch' });
    if ((custId || paramCustID) && (custId || paramCustID) !== preview.custId) return res.status(409).json({ error: 'Preview customer mismatch' });
    if (month && String(month).padStart(2, '0') !== preview.month) return res.status(409).json({ error: 'Preview month mismatch' });
    if (year && String(year) !== preview.year) return res.status(409).json({ error: 'Preview year mismatch' });

    const result = await commitUploadPreview(preview, req);
    previewStore.remove(previewId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Legacy direct Isilon CSV Upload ───
// POST /api/reports/upload — kept for backward compatibility; internally previews then confirms
reportRouter.post('/upload', requireInternal, uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }
    const preview = await buildUploadPreview({
      filePath: req.file.path,
      originalName: req.file.originalname,
      body: req.body,
      creatorUserId: req.user.id,
    });
    fs.unlinkSync(req.file.path);
    if (preview.errors.length > 0) {
      previewStore.remove(preview.previewId);
      return res.status(400).json({ error: preview.errors[0], errors: preview.errors });
    }
    const result = await commitUploadPreview(preview, req);
    previewStore.remove(preview.previewId);
    res.json({ message: 'CSV processed', processed: result.processed, skipped: result.skipped, fileHash: result.fileHash });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// ─── Breakdown CSV Upload (CSV2 — MXFSERVER) ───
// POST /api/reports/upload-breakdown
reportRouter.post('/upload-breakdown', requireInternal, uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    const { reportDate, paramCustID: custId } = req.body;
    if (!reportDate || !custId) {
      return res.status(400).json({ error: 'reportDate and paramCustID are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const [yearString, monthString] = reportDate.split('-');
    await assertPeriodMutable(prisma, { custId, month: monthString, year: yearString });
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');

    const records = parse(fileContent, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    let procCount = 0;
    let skipCount = 0;

    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      if (!row[0] || !row[2]) continue;

      const unit = String(row[0]).replace(/'/g, '`').trim();
      const size = parseInt(row[2]) || 0;

      // Check if already exists
      const existing = await prisma.breakdown.findFirst({
        where: { unit, custId, month: monthString, year: yearString },
      });

      if (!existing) {
        await prisma.breakdown.create({
          data: {
            unit,
            usageSize: size,
            month: monthString,
            year: yearString,
            custId,
          },
        });
        procCount++;
      } else {
        skipCount++;
      }
    }

    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Breakdown CSV processed',
      processed: procCount,
      skipped: skipCount,
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(err);
  }
});

const repriceSchema = z.object({
  custId: z.string().min(1),
  month: z.string().min(1).max(2).transform(m => m.padStart(2, '0')).pipe(z.string().regex(/^(0[1-9]|1[0-2])$/)),
  year: z.string().regex(/^\d{4}$/),
  priceId: z.string().uuid(),
});

// PUT /api/reports/reprice — retroactively change price tier for reports
reportRouter.put('/reprice', requireInternal, async (req, res, next) => {
  try {
    // Graceful validation — return 400 instead of crashing on missing/undefined fields
    const parsed = repriceSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
      return res.status(400).json({ error: `Validation failed: ${messages}` });
    }
    const { custId, month, year, priceId } = parsed.data;
    const result = await repriceReportsTransaction(prisma, {
      custId,
      month,
      year,
      priceId,
      actor: { id: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/bulk — atomically soft-delete selected rows from one report period
reportRouter.delete('/bulk', requireInternal, async (req, res, next) => {
  try {
    const input = validateBulkDeleteInput(req.body);
    const result = await softDeleteReports(prisma, {
      ...input,
      custId: await resolveCustomerId(input.custId),
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({
      message: `${result.deleted} report row${result.deleted === 1 ? '' : 's'} removed`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports — list reports with filters
reportRouter.get('/', async (req, res, next) => {
  try {
    const { cust_id, month, year } = req.query;

    const where = { deletedAt: null };
    if (req.user?.role === 'customer_viewer') {
      if (!req.user.custId) return res.status(403).json({ error: 'Customer scope is required' });
      if (cust_id && await resolveCustomerId(cust_id) !== req.user.custId) return res.status(403).json({ error: 'Customer scope mismatch' });
      where.custId = req.user.custId;
    } else if (cust_id) where.custId = await resolveCustomerId(cust_id);
    if (month) where.month = month;
    if (year) where.year = year;

    const reports = await prisma.report.findMany({
      where,
      include: {
        folder: {
          include: {
            department: {
              include: { customer: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(reports.map(r => ({
      id: r.id,
      folder_name: r.folder.folderName,
      folder_dir: r.folderDir,
      department: r.folder.department.deptName,
      customer: r.folder.department.customer.custName,
      usage_gb: billableUsageGb(r.usageSize),
      usage_bytes: String(billableUsageBytes(r.usageSize)),
      dir_count: r.dirCount,
      file_count: r.fileCount,
      month: r.month,
      year: r.year,
      file_name: r.fileName,
      price_per_gb: Number(r.pricePerGb),
    })));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/:id (soft delete)
reportRouter.delete('/:id', requireInternal, async (req, res, next) => {
  try {
    await softDeleteReportTransaction(prisma, {
      reportId: req.params.id,
      actor: { id: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });
    res.json({ message: 'Report soft-deleted' });
  } catch (err) {
    next(err);
  }
});
