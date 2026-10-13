import test from 'node:test';
import assert from 'node:assert/strict';
import { requireInternal } from '../src/middleware/auth.js';

function invoke(role) {
  let status = null;
  let body = null;
  let proceeded = false;
  const req = { user: role === undefined ? {} : { role } };
  const res = {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  };
  requireInternal(req, res, () => { proceeded = true; });
  return { status, body, proceeded };
}

test('internal authorization explicitly allows only admin and user roles', () => {
  assert.equal(invoke('admin').proceeded, true);
  assert.equal(invoke('user').proceeded, true);
  for (const role of ['customer_viewer', 'unknown', '', undefined]) {
    const result = invoke(role);
    assert.equal(result.proceeded, false);
    assert.equal(result.status, 403);
  }
});
