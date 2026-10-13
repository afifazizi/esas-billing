import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccessToken,
  validateJwtConfiguration,
  verifyAccessToken,
} from '../src/utils/jwt.js';

const strongAccess = 'access-secret-0123456789-ABCDEFGHIJKL';
const strongRefresh = 'refresh-secret-0123456789-MNOPQRSTUV';

function withJwtEnv(values, fn) {
  const before = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  };
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('JWT configuration rejects missing, weak, and identical secrets', () => {
  assert.throws(() => withJwtEnv({ JWT_ACCESS_SECRET: undefined, JWT_REFRESH_SECRET: undefined }, validateJwtConfiguration), /JWT_ACCESS_SECRET/);
  assert.throws(() => withJwtEnv({ JWT_ACCESS_SECRET: 'dev-secret', JWT_REFRESH_SECRET: strongRefresh }, validateJwtConfiguration), /at least 32/);
  assert.throws(() => withJwtEnv({ JWT_ACCESS_SECRET: strongAccess, JWT_REFRESH_SECRET: strongAccess }, validateJwtConfiguration), /must be different/);
});

test('JWT token operations read validated secrets without production fallbacks', () => {
  withJwtEnv({ JWT_ACCESS_SECRET: strongAccess, JWT_REFRESH_SECRET: strongRefresh }, () => {
    assert.deepEqual(validateJwtConfiguration(), { accessSecret: strongAccess, refreshSecret: strongRefresh });
    const token = generateAccessToken({ id: 'u1', username: 'operator', userRole: 'user', custId: null });
    assert.equal(verifyAccessToken(token).id, 'u1');
  });
  assert.throws(
    () => withJwtEnv({ JWT_ACCESS_SECRET: undefined, JWT_REFRESH_SECRET: strongRefresh }, () => generateAccessToken({ id: 'u1', username: 'operator', userRole: 'user' })),
    /JWT_ACCESS_SECRET/,
  );
});
