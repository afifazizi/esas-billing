import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLifecycleActions,
  isPeriodMutable,
  normalizeLifecycleStatus,
} from './report-lifecycle.ts';

test('normalizes missing and unknown lifecycle states to DRAFT', () => {
  assert.equal(normalizeLifecycleStatus(undefined), 'DRAFT');
  assert.equal(normalizeLifecycleStatus('reviewed'), 'REVIEWED');
  assert.equal(normalizeLifecycleStatus('unexpected'), 'DRAFT');
});

test('only approved and locked periods block report mutations', () => {
  assert.equal(isPeriodMutable('DRAFT'), true);
  assert.equal(isPeriodMutable('REVIEWED'), true);
  assert.equal(isPeriodMutable('APPROVED'), false);
  assert.equal(isPeriodMutable('LOCKED'), false);
});

test('internal users can submit populated drafts but cannot approve or lock', () => {
  assert.deepEqual(getLifecycleActions('DRAFT', 'user', false), []);
  assert.deepEqual(getLifecycleActions('DRAFT', 'user', true).map((action) => action.target), ['REVIEWED']);
  assert.deepEqual(getLifecycleActions('REVIEWED', 'user', true), []);
});

test('admins receive the correct next transition and reopen option', () => {
  assert.deepEqual(getLifecycleActions('DRAFT', 'admin', true).map((action) => action.target), ['REVIEWED']);
  assert.deepEqual(getLifecycleActions('REVIEWED', 'admin', true).map((action) => action.target), ['APPROVED', 'DRAFT']);
  assert.deepEqual(getLifecycleActions('APPROVED', 'admin', true).map((action) => action.target), ['LOCKED', 'DRAFT']);
  assert.deepEqual(getLifecycleActions('LOCKED', 'admin', true).map((action) => action.target), ['DRAFT']);
});

test('customer viewers never receive lifecycle actions', () => {
  assert.deepEqual(getLifecycleActions('DRAFT', 'customer_viewer', true), []);
  assert.deepEqual(getLifecycleActions('LOCKED', 'customer_viewer', true), []);
});
