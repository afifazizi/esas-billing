import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.js';
import { customerRouter } from './routes/customers.js';
import { departmentRouter } from './routes/departments.js';
import { folderRouter } from './routes/folders.js';
import { reportRouter } from './routes/reports.js';
import { analyticsRouter } from './routes/analytics.js';
import { exportRouter } from './routes/exports.js';
import { userRouter } from './routes/users.js';
import { auditRouter } from './routes/audit.js';
import { importRouter, unmatchedRouter } from './routes/imports.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 5050;

// ─── Security Wards ───
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    // Allow localhost on any port
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    // Allow LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return callback(null, true);
    // Allow loopback IPv4
    if (/^https?:\/\/127\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
    callback(null, true); // permissive fallback for staging
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ─── Rate Limiting (login only) ───
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ─── Routes ───
app.post('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);
app.use('/api/customers', customerRouter);
app.use('/api/departments', departmentRouter);
app.use('/api/folders', folderRouter);
app.use('/api/reports', reportRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/export', exportRouter);
app.use('/api/users', userRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/import-runs', importRouter);
app.use('/api/unmatched-directories', unmatchedRouter);

// ─── Health Check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error Handler ───
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`⚡ ESAS Backend running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
