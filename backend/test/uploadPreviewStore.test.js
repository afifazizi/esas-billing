import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreviewStore } from '../src/services/uploadPreviewStore.js';

test('upload previews use private permissions and are bound to the creating user', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esas-preview-test-'));
  try {
    const store = createPreviewStore({ directory: dir, ttlMs: 1000 });
    const saved = store.save({ custId: 'C1' }, 'creator-1');
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(store.filePath(saved.previewId)).mode & 0o777, 0o600);
    assert.equal(store.load(saved.previewId, 'creator-1').creatorUserId, 'creator-1');
    assert.throws(() => store.load(saved.previewId, 'creator-2'), (error) => error.status === 403);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upload preview store expires requested previews and purges stale preview files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esas-preview-test-'));
  let now = 1000;
  try {
    const store = createPreviewStore({ directory: dir, ttlMs: 100, now: () => now });
    const first = store.save({ custId: 'C1' }, 'u1');
    now = 1200;
    const second = store.save({ custId: 'C1' }, 'u1');
    assert.equal(fs.existsSync(store.filePath(first.previewId)), false, 'saving purges stale previews');
    now = 1400;
    assert.throws(() => store.load(second.previewId, 'u1'), (error) => error.status === 410);
    assert.equal(fs.existsSync(store.filePath(second.previewId)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
