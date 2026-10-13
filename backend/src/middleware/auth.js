import { verifyAccessToken } from '../utils/jwt.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireInternal(req, res, next) {
  if (!['admin', 'user'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Internal access required' });
  }
  next();
}

export function requireCustomerScope(req, res, next) {
  if (req.user?.role !== 'customer_viewer') return next();
  if (!req.user?.custId) {
    return res.status(403).json({ error: 'Customer scope is required' });
  }
  next();
}

export function customerViewerBlocked(req, res, next) {
  if (req.user?.role === 'customer_viewer') {
    return res.status(403).json({ error: 'Customer users are read-only' });
  }
  next();
}
