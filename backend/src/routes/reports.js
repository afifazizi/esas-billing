import { Router } from 'express';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import os from 'os';
import path from 'path';
import prisma from '../db.js';
import { authenticate, customerViewerBlocked } from '../middleware/auth.js';
import { uploadCsv } from '../middleware/upload.js';
import { z } from 'zod';
import { auditLog } from '../utils/audit.js';

export const reportRouter = Router();
reportRouter.use(authenticate);
reportRouter.use((req, res, next) => {
  if (req.method !== 'GET' && req.user?.role === 'customer_viewer') {
    return res.status(403).json({ error: 'Customer users are read-only' });
  }
  next();
});

const PREVIEW_DIR = path.join(os.tmpdir(), 'esas-upload-previews');
const PREVIEW_TTL_MS = 60 * 60 * 1000;

function ensurePreviewDir() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

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

function bytesToGb(bytes) {
  return Math.ceil(Number(bytes || 0n) / 1073741824);
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

function previewFilePath(previewId) {
  if (!/^[a-f0-9-]{36}$/.test(previewId)) {
    const err = new Error('Invalid previewId');
    err.status = 400;
    throw err;
  }
  return path.join(PREVIEW_DIR, `${previewId}.json`);
}

function savePreview(preview) {
  ensurePreviewDir();
  const previewId = crypto.randomUUID();
  const saved = { ...preview, previewId, createdAt: new Date().toISOString() };
  fs.writeFileSync(previewFilePath(previewId), JSON.stringify(saved));
  return saved;
}

function loadPreview(previewId) {
  const filePath = previewFilePath(previewId);
  if (!fs.existsSync(filePath)) {
    const err = new Error('Preview has expired or does not exist. Generate a new preview.');
    err.status = 404;
    throw err;
  }
  const preview = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (Date.now() - new Date(preview.createdAt).getTime() > PREVIEW_TTL_MS) {
    fs.unlinkSync(filePath);
    const err = new Error('Preview has expired. Generate a new preview.');
    err.status = 410;
    throw err;
  }
  return preview;
}

function removePreview(previewId) {
  try {
    fs.unlinkSync(previewFilePath(previewId));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function findColumn(header, needle) {
  return header.findIndex((h) => String(h).trim().toLowerCase().includes(needle));
}

async function buildUploadPreview({ filePath, originalName, body }) {
  const { custId, year, month } = parseReportParams(body);
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
      const sizeBytes = parseBigIntSafe(row[colPhysCount]);
      const dirCount = parseIntSafe(row[colDirCount]);
      const fileCount = parseIntSafe(row[colFileCount]);
      const adsCount = parseIntSafe(row[colAdsCount]);
      const otherCount = parseIntSafe(row[colOtherCount]);
      estimatedBytes += sizeBytes;

      const baseRow = {
        rowNumber,
        directoryPath,
        usageGb: bytesToGb(sizeBytes),
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

  return savePreview({
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
    estimatedUsageBytes: String(estimatedBytes),
    estimatedUsageGb: bytesToGb(estimatedBytes),
    errors,
    warnings,
    rows: rows.slice(0, 100),
    matchedRows,
    unmatchedRows,
  });
}

async function commitUploadPreview(preview, req) {
  if (preview.errors?.length) {
    const err = new Error('Preview contains validation errors. Fix the CSV and generate a new preview.');
    err.status = 400;
    throw err;
  }

  let importRun;
  let insertedCount = 0;
  let skippedCount = Number(preview.skippedCount || 0) + Number(preview.duplicateCount || 0);

  await prisma.$transaction(async (tx) => {
    for (const row of preview.matchedRows || []) {
      const duplicate = await tx.report.findFirst({
        where: {
          folderId: row.folderId,
          month: preview.month,
          year: preview.year,
          fileHash: preview.fileHash,
          deletedAt: null,
        },
      });
      if (duplicate) {
        skippedCount++;
        continue;
      }

      await tx.report.create({
        data: {
          folderId: row.folderId,
          usageSize: BigInt(row.sizeBytes),
          month: preview.month,
          year: preview.year,
          pricePerGb: row.pricePerGb,
          priceId: preview.priceId || null,
          fileHash: preview.fileHash,
          fileName: preview.fileName.replace(/\.csv$/i, ''),
          folderDir: row.directoryPath,
          dirCount: row.dirCount,
          fileCount: row.fileCount,
          adsCount: row.adsCount,
          otherCount: row.otherCount,
          custId: preview.custId,
        },
      });
      insertedCount++;
    }

    importRun = await tx.importRun.create({
      data: {
        userId: req.user.id,
        fileName: preview.fileName,
        fileHash: preview.fileHash,
        month: preview.month,
        year: preview.year,
        custId: preview.custId,
        matchedCount: Number(preview.matchedCount || 0),
        unmatchedCount: Number(preview.unmatchedCount || 0),
        insertedCount,
        skippedCount,
        status: Number(preview.unmatchedCount || 0) > 0 ? 'PARTIAL' : 'SUCCESS',
      },
    });

    for (const row of preview.unmatchedRows || []) {
      await tx.unmatchedDirectory.create({
        data: {
          importRunId: importRun.id,
          directoryPath: row.directoryPath,
          sizeBytes: BigInt(row.sizeBytes),
          fileCount: row.fileCount,
          status: 'PENDING',
        },
      });
    }
  });

  await auditLog({
    userId: req.user.id,
    action: 'UPLOAD_REPORT',
    entityType: 'ImportRun',
    entityId: importRun.id,
    newValue: {
      fileName: preview.fileName,
      custId: preview.custId,
      month: preview.month,
      year: preview.year,
      matched: preview.matchedCount,
      unmatched: preview.unmatchedCount,
      inserted: insertedCount,
      skipped: skippedCount,
    },
    req,
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
reportRouter.post('/upload/preview', uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }
    const preview = await buildUploadPreview({
      filePath: req.file.path,
      originalName: req.file.originalname,
      body: req.body,
    });
    fs.unlinkSync(req.file.path);
    res.json(preview);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// POST /api/reports/upload/confirm — commit a previously reviewed preview
reportRouter.post('/upload/confirm', async (req, res, next) => {
  try {
    const { previewId, fileHash, custId, paramCustID, month, year } = req.body;
    if (!previewId) return res.status(400).json({ error: 'previewId is required' });

    const preview = loadPreview(previewId);
    if (fileHash && fileHash !== preview.fileHash) return res.status(409).json({ error: 'Preview file hash mismatch' });
    if ((custId || paramCustID) && (custId || paramCustID) !== preview.custId) return res.status(409).json({ error: 'Preview customer mismatch' });
    if (month && String(month).padStart(2, '0') !== preview.month) return res.status(409).json({ error: 'Preview month mismatch' });
    if (year && String(year) !== preview.year) return res.status(409).json({ error: 'Preview year mismatch' });

    const result = await commitUploadPreview(preview, req);
    removePreview(previewId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Legacy direct Isilon CSV Upload ───
// POST /api/reports/upload — kept for backward compatibility; internally previews then confirms
reportRouter.post('/upload', uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }
    const preview = await buildUploadPreview({
      filePath: req.file.path,
      originalName: req.file.originalname,
      body: req.body,
    });
    fs.unlinkSync(req.file.path);
    if (preview.errors.length > 0) {
      removePreview(preview.previewId);
      return res.status(400).json({ error: preview.errors[0], errors: preview.errors });
    }
    const result = await commitUploadPreview(preview, req);
    removePreview(preview.previewId);
    res.json({ message: 'CSV processed', processed: result.processed, skipped: result.skipped, fileHash: result.fileHash });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// ─── Breakdown CSV Upload (CSV2 — MXFSERVER) ───
// POST /api/reports/upload-breakdown
reportRouter.post('/upload-breakdown', uploadCsv.single('file_name'), async (req, res, next) => {
  try {
    const { reportDate, paramCustID: custId } = req.body;
    if (!reportDate || !custId) {
      return res.status(400).json({ error: 'reportDate and paramCustID are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const [yearString, monthString] = reportDate.split('-');
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
reportRouter.put('/reprice', async (req, res, next) => {
  try {
    // Graceful validation — return 400 instead of crashing on missing/undefined fields
    const parsed = repriceSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
      return res.status(400).json({ error: `Validation failed: ${messages}` });
    }
    const { custId, month, year, priceId } = parsed.data;

    const tier = await prisma.price.findUnique({ where: { id: priceId } });
    if (!tier) {
      return res.status(404).json({ error: 'Price tier not found' });
    }
    if (tier.custId !== custId) {
      return res.status(400).json({ error: 'Price tier does not belong to this customer' });
    }

    const result = await prisma.report.updateMany({
      where: { custId, month, year, deletedAt: null },
      data: { pricePerGb: tier.price, priceId: tier.id },
    });

    await auditLog({
      userId: req.user.id,
      action: 'REPRICE_REPORTS',
      entityType: 'Report',
      entityId: custId,
      newValue: { custId, month, year, priceId, pricePerGb: tier.price, updated: result.count },
      req,
    });

    res.json({
      updated: result.count,
      pricePerGb: tier.price,
      priceLabel: tier.label || '',
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
      usage_gb: Math.ceil(Number(r.usageSize) / 1073741824),
      usage_bytes: String(r.usageSize),
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
reportRouter.delete('/:id', async (req, res, next) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    await prisma.report.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Report soft-deleted' });
  } catch (err) {
    next(err);
  }
});
