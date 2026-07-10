import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../utils/audit.js';
import { z } from 'zod';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/, 'Must contain uppercase').regex(/[0-9]/, 'Must contain number'),
});

// POST /api/auth/login
authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { username }, include: { customer: { select: { custName: true } } } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'User account is disabled' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await auditLog({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      req,
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullname: user.fullname,
        userRole: user.userRole,
        mustChangePassword: user.mustChangePassword,
        custId: user.custId,
        customerName: user.customer?.custName || null,
        isActive: user.isActive !== false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req, res) => {
  // JWT is stateless; client discards tokens
  res.json({ message: 'Logged out' });
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.isActive === false) {
      return res.status(401).json({ error: 'User account is disabled' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, email: true, fullname: true, userRole: true, mustChangePassword: true, custId: true, isActive: true, lastLoginAt: true, customer: { select: { custName: true } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...user,
      customerName: user.customer?.custName || null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/password
authRouter.put('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashed = await bcrypt.hash(newPassword, rounds);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed, mustChangePassword: false },
    });

    await auditLog({
      userId: req.user.id,
      action: 'CHANGE_PASSWORD',
      entityType: 'User',
      entityId: req.user.id,
      req,
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
});
