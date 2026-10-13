import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, requireInternal } from '../middleware/auth.js';
import { billableUsageBytes, exactBillableUsageGb } from '../utils/usageThreshold.js';
import { ignoreUnmatchedDirectoryTransaction, mapUnmatchedDirectoryTransaction } from '../services/unmatchedMutations.js';

const importRouter = Router();
importRouter.use(authenticate);
importRouter.use(requireInternal);

// ─── Import Runs ───

// GET / — paginated list with optional filters
importRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { custId, month, year, status } = req.query;

    const where = {};
    if (custId) where.custId = custId;
    if (month) where.month = month;
    if (year) where.year = year;
    if (status) {
      const normalizedStatus = String(status).toUpperCase();
      if (!['SUCCESS', 'PARTIAL', 'FAILED'].includes(normalizedStatus)) return res.status(400).json({ error: 'Invalid import status' });
      where.status = normalizedStatus;
    }

    const [total, runs] = await Promise.all([
      prisma.importRun.count({ where }),
      prisma.importRun.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, fullname: true } },
          customer: { select: { custId: true, custName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      data: runs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /:id — detail with unmatched directories
importRouter.get('/:id', async (req, res, next) => {
  try {
    const run = await prisma.importRun.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, username: true, fullname: true } },
        customer: { select: { custId: true, custName: true } },
        unmatchedDirs: {
          include: {
            mappedFolder: {
              select: { folderId: true, folderName: true, folderDirectory: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!run) return res.status(404).json({ error: 'Import run not found' });

    // Serialize BigInt fields for JSON
    const serialized = {
      ...run,
      unmatchedDirs: run.unmatchedDirs.map(d => ({
        id: d.id,
        importRunId: d.importRunId,
        directoryPath: d.directoryPath,
        sizeGb: exactBillableUsageGb(d.sizeBytes),
        sizeBytes: String(billableUsageBytes(d.sizeBytes)),
        fileCount: d.fileCount,
        status: d.status,
        mappedFolderId: d.mappedFolderId,
        mappedFolder: d.mappedFolder,
        createdAt: d.createdAt,
      })),
    };

    res.json(serialized);
  } catch (err) {
    next(err);
  }
});

// ─── Unmatched Directories — separate router ───

const unmatchedRouter = Router();
unmatchedRouter.use(authenticate);
unmatchedRouter.use(requireInternal);

function serializeUnmatchedDirectory(dir) {
  const sizeBytes = billableUsageBytes(dir.sizeBytes);
  return {
    ...dir,
    sizeBytes: String(sizeBytes),
    sizeGb: exactBillableUsageGb(sizeBytes),
    importRunDate: dir.importRun?.createdAt || dir.createdAt,
  };
}

// GET / — list with optional status filter
unmatchedRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { status, year, month, custId } = req.query;

    const where = {};
    if (status && ['PENDING', 'RESOLVED', 'IGNORED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }
    if (year || month || custId) where.importRun = {
      ...(year ? { year: String(year) } : {}),
      ...(month ? { month: String(month).padStart(2, '0') } : {}),
      ...(custId ? { custId: String(custId) } : {}),
    };

    const [total, dirs] = await Promise.all([
      prisma.unmatchedDirectory.count({ where }),
      prisma.unmatchedDirectory.findMany({
        where,
        include: {
          importRun: {
            select: { id: true, fileName: true, month: true, year: true, custId: true, createdAt: true },
          },
          mappedFolder: {
            select: { folderId: true, folderName: true, folderDirectory: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      data: dirs.map(serializeUnmatchedDirectory),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /:id/map — map to existing folder
unmatchedRouter.put('/:id/map', async (req, res, next) => {
  try {
    const { folderId } = req.body;
    if (!folderId) return res.status(400).json({ error: 'folderId is required' });
    const result = await mapUnmatchedDirectoryTransaction(prisma, {
      directoryId: req.params.id,
      folderId,
      actor: { id: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });
    res.json({
      ...serializeUnmatchedDirectory(result.updated),
      reportId: result.report.id,
      createdReport: result.createdReport,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /:id/ignore — mark unmatched directory as ignored
unmatchedRouter.put('/:id/ignore', async (req, res, next) => {
  try {
    const updated = await ignoreUnmatchedDirectoryTransaction(prisma, {
      directoryId: req.params.id,
      actor: { id: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });
    res.json(serializeUnmatchedDirectory(updated));
  } catch (err) {
    next(err);
  }
});

export { importRouter, unmatchedRouter };
