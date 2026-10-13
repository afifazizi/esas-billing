import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

export function createPreviewStore({ directory, ttlMs, now = () => Date.now() }) {
  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  function filePath(previewId) {
    if (!/^[a-f0-9-]{36}$/.test(String(previewId || ''))) throw httpError(400, 'Invalid previewId');
    return path.join(directory, `${previewId}.json`);
  }
  function purgeStale() {
    ensureDirectory();
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const target = path.join(directory, name);
      try {
        const preview = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (!preview.createdAtMs || now() - Number(preview.createdAtMs) > ttlMs) fs.unlinkSync(target);
      } catch {
        fs.unlinkSync(target);
      }
    }
  }
  function save(preview, creatorUserId) {
    if (!creatorUserId) throw httpError(401, 'Authenticated preview creator is required');
    purgeStale();
    const previewId = crypto.randomUUID();
    const createdAtMs = now();
    const saved = { ...preview, previewId, creatorUserId, createdAtMs, createdAt: new Date(createdAtMs).toISOString() };
    fs.writeFileSync(filePath(previewId), JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
    fs.chmodSync(filePath(previewId), 0o600);
    return saved;
  }
  function load(previewId, userId) {
    const target = filePath(previewId);
    if (!fs.existsSync(target)) throw httpError(404, 'Preview has expired or does not exist. Generate a new preview.');
    const preview = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (preview.creatorUserId !== userId) throw httpError(403, 'Preview belongs to a different user');
    if (!preview.createdAtMs || now() - Number(preview.createdAtMs) > ttlMs) {
      fs.unlinkSync(target);
      throw httpError(410, 'Preview has expired. Generate a new preview.');
    }
    return preview;
  }
  function remove(previewId) {
    try { fs.unlinkSync(filePath(previewId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { filePath, load, purgeStale, remove, save };
}
