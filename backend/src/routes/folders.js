import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, customerViewerBlocked } from '../middleware/auth.js';
import { generateFolderId } from '../utils/generateId.js';
import { z } from 'zod';

export const folderRouter = Router();
folderRouter.use(authenticate);
folderRouter.use(customerViewerBlocked);

// GET /api/folders — global list for admin mapping dropdowns
folderRouter.get('/', async (req, res, next) => {
  try {
    const folders = await prisma.folder.findMany({
      where: { deletedAt: null },
      select: {
        folderId: true,
        folderName: true,
        folderDirectory: true,
        department: { select: { deptName: true } },
      },
      orderBy: { folderName: 'asc' },
    });

    res.json(folders.map((folder) => ({
      id: folder.folderId,
      name: folder.folderName,
      path: folder.folderDirectory,
      departmentName: folder.department?.deptName || null,
    })));
  } catch (err) {
    next(err);
  }
});

const folderSchema = z.object({
  folder_id: z.string().min(1).max(255).optional(),
  folder_directory: z.string().min(1).max(500),
  folder_name: z.string().min(1).max(255),
  folder_desc: z.string().max(1000).optional(),
  folder_short_name: z.string().max(255).optional(),
});

// GET /api/departments/:deptId/folders
folderRouter.get('/departments/:deptId/folders', async (req, res, next) => {
  try {
    const folders = await prisma.folder.findMany({
      where: { deptId: req.params.deptId, deletedAt: null },
    });
    res.json(folders);
  } catch (err) {
    next(err);
  }
});

// POST /api/departments/:deptId/folders
folderRouter.post('/departments/:deptId/folders', async (req, res, next) => {
  try {
    const data = folderSchema.parse(req.body);

    const folderId = data.folder_id || await generateFolderId(prisma, data.folder_name, data.folder_short_name, req.params.deptId);

    const existing = await prisma.folder.findUnique({ where: { folderId } });
    if (existing) return res.status(409).json({ error: 'Folder ID already exists' });

    const folder = await prisma.folder.create({
      data: {
        folderId,
        folderDirectory: data.folder_directory,
        folderName: data.folder_name,
        folderDesc: data.folder_desc,
        folderShortName: data.folder_short_name,
        deptId: req.params.deptId,
      },
    });

    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
});

// PUT /api/folders/:id
folderRouter.put('/:id', async (req, res, next) => {
  try {
    const data = folderSchema.partial().parse(req.body);

    const folder = await prisma.folder.findUnique({ where: { folderId: req.params.id } });
    if (!folder || folder.deletedAt) return res.status(404).json({ error: 'Folder not found' });

    const updated = await prisma.folder.update({
      where: { folderId: req.params.id },
      data: {
        ...(data.folder_directory && { folderDirectory: data.folder_directory }),
        ...(data.folder_name && { folderName: data.folder_name }),
        ...(data.folder_desc !== undefined && { folderDesc: data.folder_desc }),
        ...(data.folder_short_name !== undefined && { folderShortName: data.folder_short_name }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/folders/:id (soft delete)
folderRouter.delete('/:id', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { folderId: req.params.id } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    await prisma.folder.update({
      where: { folderId: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Folder soft-deleted' });
  } catch (err) {
    next(err);
  }
});
