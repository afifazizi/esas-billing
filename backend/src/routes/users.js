import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../utils/audit.js';
import { z } from 'zod';

export const userRouter = Router();
userRouter.use(authenticate);

const roleSchema = z.enum(['admin', 'user', 'customer_viewer']);

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1).max(255),
  fullname: z.string().min(1).max(255),
  role: roleSchema.optional(),
  userRole: roleSchema.optional(),
  mustChangePassword: z.boolean().optional(),
  custId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).regex(/[A-Z]/, 'Must contain uppercase').regex(/[0-9]/, 'Must contain number'),
}).superRefine((data, ctx) => {
  const role = data.role ?? data.userRole;
  if (!data.role && !data.userRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['role'],
      message: 'Either role or userRole is required',
    });
  }

  if (role === 'customer_viewer' && !data.custId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['custId'], message: 'Customer is required for customer_viewer users' });
  }

  if (data.role && data.userRole && data.role !== data.userRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['userRole'],
      message: 'userRole must match role when both are provided',
    });
  }
}).transform((data) => ({
  ...data,
  role: data.role ?? data.userRole,
  custId: (data.role ?? data.userRole) === 'customer_viewer' ? data.custId : null,
}));

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(1).max(255).optional(),
  fullname: z.string().min(1).max(255).optional(),
  role: roleSchema.optional(),
  userRole: roleSchema.optional(),
  custId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  const role = data.role ?? data.userRole;
  if (role === 'customer_viewer' && !data.custId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['custId'], message: 'Customer is required for customer_viewer users' });
  }
}).transform((data) => ({ ...data, role: data.role ?? data.userRole }));

// GET /api/users (admin only)
userRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        fullname: true,
        userRole: true,
        custId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        customer: { select: { custName: true } },
      },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/users (admin only)
userRouter.post('/', requireAdmin, async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);

    const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingEmail) return res.status(409).json({ error: 'Email already exists' });

    const existingUsername = await prisma.user.findUnique({ where: { username: data.username } });
    if (existingUsername) return res.status(409).json({ error: 'Username already exists' });

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashed = await bcrypt.hash(data.password, rounds);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        fullname: data.fullname,
        userRole: data.role,
        ...(data.mustChangePassword !== undefined && { mustChangePassword: data.mustChangePassword }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        custId: data.custId || null,
        password: hashed,
      },
    });

    await auditLog({
      userId: req.user.id,
      action: 'CREATE_USER',
      entityType: 'User',
      entityId: user.id,
      newValue: { username: user.username, email: user.email, fullname: user.fullname, role: user.userRole, custId: user.custId },
      req,
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      fullname: user.fullname,
      role: user.userRole,
      userRole: user.userRole,
      mustChangePassword: user.mustChangePassword,
      custId: user.custId,
      isActive: user.isActive,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id (admin only)
userRouter.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = updateUserSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.email && { email: data.email }),
        ...(data.username && { username: data.username }),
        ...(data.fullname && { fullname: data.fullname }),
        ...(data.role && { userRole: data.role }),
        ...(data.custId !== undefined && { custId: data.role === 'customer_viewer' || (!data.role && user.userRole === 'customer_viewer') ? data.custId : null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    await auditLog({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'User',
      entityId: req.params.id,
      oldValue: { username: user.username, email: user.email, fullname: user.fullname, role: user.userRole },
      newValue: { username: updated.username, email: updated.email, fullname: updated.fullname, role: updated.userRole, custId: updated.custId, isActive: updated.isActive },
      req,
    });

    res.json({
      id: updated.id,
      username: updated.username,
      email: updated.email,
      fullname: updated.fullname,
      role: updated.userRole,
      userRole: updated.userRole,
      custId: updated.custId,
      isActive: updated.isActive,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id (admin only, cannot delete self)
userRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.user.delete({ where: { id: req.params.id } });

    await auditLog({
      userId: req.user.id,
      action: 'DELETE_USER',
      entityType: 'User',
      entityId: req.params.id,
      oldValue: { username: user.username, email: user.email },
      req,
    });

    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id/password (admin reset user password)
userRouter.put('/:id/password', requireAdmin, async (req, res, next) => {
  try {
    const { password, mustChangePassword } = z.object({
      password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
      mustChangePassword: z.boolean().optional(),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashed = await bcrypt.hash(password, rounds);

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        password: hashed,
        ...(mustChangePassword !== undefined && { mustChangePassword }),
      },
    });

    await auditLog({
      userId: req.user.id,
      action: 'RESET_PASSWORD',
      entityType: 'User',
      entityId: req.params.id,
      oldValue: { username: user.username },
      req,
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
});
