import test from 'node:test';
import assert from 'node:assert/strict';
import { reportRouter } from '../src/routes/reports.js';
import { importRouter, unmatchedRouter } from '../src/routes/imports.js';
import { reportPeriodRouter } from '../src/routes/reportPeriods.js';

function routeMiddlewareNames(router, method, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack.map((item) => item.handle.name);
}

function routerMiddlewareNames(router) {
  return router.stack.filter((item) => !item.route).map((item) => item.handle.name);
}

test('sensitive report mutations use the fail-closed internal allowlist', () => {
  for (const [method, path] of [
    ['post', '/upload/preview'], ['post', '/upload/confirm'], ['post', '/upload'],
    ['post', '/upload-breakdown'], ['put', '/reprice'], ['delete', '/bulk'], ['delete', '/:id'],
  ]) {
    assert.ok(routeMiddlewareNames(reportRouter, method, path).includes('requireInternal'), `${method} ${path}`);
  }
});

test('imports, unmatched mutations, and report-period transitions require internal roles', () => {
  assert.ok(routerMiddlewareNames(importRouter).includes('requireInternal'));
  assert.ok(routerMiddlewareNames(unmatchedRouter).includes('requireInternal'));
  assert.ok(routeMiddlewareNames(reportPeriodRouter, 'post', '/transition').includes('requireInternal'));
  assert.ok(routeMiddlewareNames(reportPeriodRouter, 'put', '/transition').includes('requireInternal'));
});
