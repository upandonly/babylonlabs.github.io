const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  fetchRemoteDocument,
  readCacheManifest,
} = require('../plugins/fetch-remote-docs.cjs');

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-docs-cache-'));
  return {
    cacheDir: path.join(root, 'cache'),
    outPath: path.join(root, 'static', 'remote-docs', 'guide.html'),
    root,
  };
}

test('a fresh fetch updates the cache and provenance', async () => {
  const workspace = createWorkspace();
  const warnings = [];

  const result = await fetchRemoteDocument({
    cacheDir: workspace.cacheDir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '# Remote guide\n\nFresh content.',
      url: 'https://raw.example/resolved/guide.md',
    }),
    now: () => '2026-09-01T00:00:00.000Z',
    outPath: workspace.outPath,
    releaseTag: 'v1.0.0',
    sourceUrl: 'https://raw.example/main/guide.md',
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, 'fresh');
  assert.equal(warnings.length, 0);
  assert.match(fs.readFileSync(workspace.outPath, 'utf8'), /Fresh content\./);

  const manifest = readCacheManifest(workspace.cacheDir);
  const entry = Object.values(manifest.entries)[0];
  assert.equal(entry.resolvedUrl, 'https://raw.example/resolved/guide.md');
  assert.equal(entry.sourceVersion, 'v1.0.0');
  assert.match(entry.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(entry.updatedAt, '2026-09-01T00:00:00.000Z');

  fs.rmSync(workspace.root, { recursive: true, force: true });
});

test('a failed fetch uses the last-known-good cache and logs a warning', async () => {
  const workspace = createWorkspace();
  const sourceUrl = 'https://raw.example/main/guide.md';

  await fetchRemoteDocument({
    cacheDir: workspace.cacheDir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '# Remote guide\n\nCached content.',
      url: sourceUrl,
    }),
    now: () => '2026-09-01T00:00:00.000Z',
    outPath: workspace.outPath,
    sourceUrl,
  });

  fs.rmSync(path.dirname(workspace.outPath), { recursive: true, force: true });
  const warnings = [];
  const result = await fetchRemoteDocument({
    cacheDir: workspace.cacheDir,
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
    now: () => '2026-09-02T00:00:00.000Z',
    outPath: workspace.outPath,
    sourceUrl,
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, 'cached');
  assert.match(fs.readFileSync(workspace.outPath, 'utf8'), /Cached content\./);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning::/);
  assert.match(warnings[0], /last-known-good cache/);
  assert.match(warnings[0], /network unavailable/);

  fs.rmSync(workspace.root, { recursive: true, force: true });
});

test('a failed first fetch warns and lets the build continue', async () => {
  const workspace = createWorkspace();
  const warnings = [];

  const result = await fetchRemoteDocument({
    cacheDir: workspace.cacheDir,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    outPath: workspace.outPath,
    sourceUrl: 'https://raw.example/main/missing.md',
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.status, 'missing');
  assert.equal(fs.existsSync(workspace.outPath), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning::/);
  assert.match(warnings[0], /no cached copy exists/);

  fs.rmSync(workspace.root, { recursive: true, force: true });
});
