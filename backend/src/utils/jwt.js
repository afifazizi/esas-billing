import jwt from 'jsonwebtoken';

const MIN_SECRET_LENGTH = 32;

function configurationError(message) {
  const error = new Error(`Invalid JWT configuration: ${message}`);
  error.code = 'INVALID_JWT_CONFIGURATION';
  return error;
}

export function validateJwtConfiguration(env = process.env) {
  const accessSecret = String(env.JWT_ACCESS_SECRET || '');
  const refreshSecret = String(env.JWT_REFRESH_SECRET || '');
  if (!accessSecret) throw configurationError('JWT_ACCESS_SECRET is required');
  if (!refreshSecret) throw configurationError('JWT_REFRESH_SECRET is required');
  if (accessSecret.length < MIN_SECRET_LENGTH) throw configurationError(`JWT_ACCESS_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  if (refreshSecret.length < MIN_SECRET_LENGTH) throw configurationError(`JWT_REFRESH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  if (accessSecret === refreshSecret) throw configurationError('JWT access and refresh secrets must be different');
  return { accessSecret, refreshSecret };
}

export function generateAccessToken(user) {
  const { accessSecret } = validateJwtConfiguration();
  return jwt.sign(
    { id: user.id, username: user.username, role: user.userRole, custId: user.custId || null },
    accessSecret,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' },
  );
}

export function generateRefreshToken(user) {
  const { refreshSecret } = validateJwtConfiguration();
  return jwt.sign(
    { id: user.id, username: user.username },
    refreshSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' },
  );
}

export function verifyAccessToken(token) {
  const { accessSecret } = validateJwtConfiguration();
  return jwt.verify(token, accessSecret);
}

export function verifyRefreshToken(token) {
  const { refreshSecret } = validateJwtConfiguration();
  return jwt.verify(token, refreshSecret);
}
