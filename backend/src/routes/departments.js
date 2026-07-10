import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, customerViewerBlocked } from '../middleware/auth.js';
import { generateDeptId } from '../utils/generateId.js';
import { z } from 'zod';

export const departmentRouter = Router();
departmentRouter.use(authenticate);
departmentRouter.use(customerViewerBlocked);

const deptSchema = z.object({
  dept_id: z.string().min(1).max(255).optional(),
  dept_name: z.string().min(1).max(255),
  dept_desc: z.string().max(1000).optional(),
});

// GET /api/customers/:custId/departments
departmentRouter.get('/customers/:custId/departments', async (req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      where: { custId: req.params.custId },
      include: { _count: { select: { folders: true } } },
    });
    res.json(departments);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers/:custId/departments
departmentRouter.post('/customers/:custId/departments', async (req, res, next) => {
  try {
    const data = deptSchema.parse(req.body);

    const deptId = data.dept_id || await generateDeptId(prisma, data.dept_name, req.params.custId);

    const existing = await prisma.department.findUnique({ where: { deptId } });
    if (existing) return res.status(409).json({ error: 'Department ID already exists' });

    const dept = await prisma.department.create({
      data: {
        deptId,
        deptName: data.dept_name,
        deptDesc: data.dept_desc,
        custId: req.params.custId,
      },
    });

    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

// PUT /api/departments/:id
departmentRouter.put('/:id', async (req, res, next) => {
  try {
    const data = deptSchema.partial().parse(req.body);

    const dept = await prisma.department.findUnique({ where: { deptId: req.params.id } });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const updated = await prisma.department.update({
      where: { deptId: req.params.id },
      data: {
        ...(data.dept_name && { deptName: data.dept_name }),
        ...(data.dept_desc !== undefined && { deptDesc: data.dept_desc }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/departments/:id
departmentRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.department.delete({ where: { deptId: req.params.id } });
    res.json({ message: 'Department deleted' });
  } catch (err) {
    next(err);
  }
});
