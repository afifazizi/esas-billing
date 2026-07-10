import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, customerViewerBlocked } from '../middleware/auth.js';

const importRouter = Router();
importRouter.use(authenticate);
importRouter.use(customerViewerBlocked);

// ─── Import Runs ───

// GET / — paginated list with optional filters
importRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { custId, month, year } = req.query;

    const where = {};
    if (custId) where.custId = custId;
    if (month) where.month = month;
    if (year) where.year = year;

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
        sizeGb: Number(d.sizeBytes / 1073741824n) || 0,
        sizeBytes: String(d.sizeBytes),
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
unmatchedRouter.use(customerViewerBlocked);

function serializeUnmatchedDirectory(dir) {
  return {
    ...dir,
    sizeBytes: dir.sizeBytes?.toString() ?? '0',
    sizeGb: Number(dir.sizeBytes ?? 0n) / 1024 / 1024 / 1024,
    importRunDate: dir.importRun?.createdAt || dir.createdAt,
  };
}

// GET / — list with optional status filter
unmatchedRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { status } = req.query;

    const where = {};
    if (status && ['PENDING', 'RESOLVED', 'IGNORED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

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
    if (!folderId) {
      return res.status(400).json({ error: 'folderId is required' });
    }

    const dir = await prisma.unmatchedDirectory.findUnique({
      where: { id: req.params.id },
    });
    if (!dir) return res.status(404).json({ error: 'Unmatched directory not found' });

    const folder = await prisma.folder.findUnique({
      where: { folderId },
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
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const importRun = await prisma.importRun.findUnique({ where: { id: dir.importRunId } });
    if (!importRun) return res.status(404).json({ error: 'Import run not found' });

    if (importRun.custId && folder.department.custId !== importRun.custId) {
      return res.status(409).json({ error: 'Mapped folder belongs to a different customer than the import run' });
    }

    const selectedPrice = folder.department.customer.prices?.find((price) => price.isDefault)
      || folder.department.customer.prices?.[0]
      || null;

    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.report.findFirst({
        where: {
          folderId,
          month: importRun.month,
          year: importRun.year,
          fileHash: importRun.fileHash,
          deletedAt: null,
        },
      });

      let report = duplicate;
      if (!report) {
        report = await tx.report.create({
          data: {
            folderId,
            usageSize: dir.sizeBytes,
            month: importRun.month,
            year: importRun.year,
            pricePerGb: selectedPrice?.price || 0,
            priceId: selectedPrice?.id || null,
            fileHash: importRun.fileHash,
            fileName: importRun.fileName.replace(/\.csv$/i, ''),
            folderDir: dir.directoryPath,
            dirCount: 0,
            fileCount: dir.fileCount,
            adsCount: 0,
            otherCount: 0,
            custId: importRun.custId || folder.department.custId,
          },
        });
      }

      const updated = await tx.unmatchedDirectory.update({
        where: { id: req.params.id },
        data: {
          mappedFolderId: folderId,
          status: 'RESOLVED',
        },
      });

      if (!duplicate) {
        await tx.importRun.update({
          where: { id: importRun.id },
          data: {
            matchedCount: { increment: 1 },
            insertedCount: { increment: 1 },
            unmatchedCount: { decrement: importRun.unmatchedCount > 0 ? 1 : 0 },
            status: importRun.unmatchedCount <= 1 ? 'SUCCESS' : importRun.status,
          },
        });
      }

      return { updated, report, createdReport: !duplicate };
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
    const dir = await prisma.unmatchedDirectory.findUnique({
      where: { id: req.params.id },
    });
    if (!dir) return res.status(404).json({ error: 'Unmatched directory not found' });

    const updated = await prisma.unmatchedDirectory.update({
      where: { id: req.params.id },
      data: { status: 'IGNORED' },
    });

    res.json(serializeUnmatchedDirectory(updated));
  } catch (err) {
    next(err);
  }
});

export { importRouter, unmatchedRouter };
