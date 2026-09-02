const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  generateLlmsFiles,
  routeToHtmlPath,
} = require('../plugins/llms/generator.cjs');

const FIXTURE_PAGES = [
  ['/trustless-bitcoin-vault/start/', 'Vault Guide', 'Vault body.'],
  ['/guides/overview/bitcoin_staking/start/', 'Staking Guide', 'Staking body.'],
  ['/guides/overview/babylon_genesis/start/', 'Genesis Guide', 'Genesis body.'],
  ['/api/example/', 'API Reference', 'API body.'],
];

function createFixture() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'babylon-llms-'));

  for (const [routePath, title, body] of FIXTURE_PAGES) {
    const htmlPath = routeToHtmlPath(outDir, routePath);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(
      htmlPath,
      '<html><head>' +
        `<meta name="description" content="${title} description">` +
        '</head><body><div class="theme-doc-markdown">' +
        `<h1>${title}</h1><p>${body}</p><h2>Details</h2>` +
        '<p>More details.</p></div></body></html>'
    );
  }

  fs.writeFileSync(
    path.join(outDir, 'robots.txt'),
    'User-agent: *\nAllow: /\n\nSitemap: https://docs.example/sitemap.xml\n'
  );
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), '<urlset></urlset>');
  return outDir;
}

test('generation is deterministic and creates all discovery files', () => {
  const outDir = createFixture();
  const options = {
    baseUrl: 'https://docs.example',
    generatedAt: '2026-09-01T00:00:00Z',
    outDir,
    routesPaths: FIXTURE_PAGES.map(([routePath]) => routePath),
    sourceCommit: 'test-commit',
  };

  const first = generateLlmsFiles(options);
  const second = generateLlmsFiles(options);

  assert.deepEqual(first.files, second.files);
  assert.match(first.files['llms.txt'], /^# Babylon Labs Documentation\n\n>/);
  assert.match(first.files['llms.txt'], /\/llms-full\.txt/);
  assert.match(first.files['llms.txt'], /\/llms-sections\/api-reference\.txt/);
  assert.match(first.files['llms.txt'], /\/api\/example\/index\.md/);
  assert.match(first.files['llms-full.txt'], /API body\./);
  assert.equal(fs.existsSync(path.join(outDir, 'llms-ctx.txt')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'llms-sitemap.xml')), false);

  for (const [routePath] of FIXTURE_PAGES) {
    const markdownPath = path.join(
      path.dirname(routeToHtmlPath(outDir, routePath)),
      'index.md'
    );
    assert.equal(fs.existsSync(markdownPath), true);

    const html = fs.readFileSync(routeToHtmlPath(outDir, routePath), 'utf8');
    assert.match(html, /rel="alternate" type="text\/markdown"/);
    assert.match(html, /rel="describedby"/);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
});

test('generation leaves Docusaurus SEO files unchanged', () => {
  const outDir = createFixture();
  const robotsBefore = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
  const sitemapBefore = fs.readFileSync(
    path.join(outDir, 'sitemap.xml'),
    'utf8'
  );

  generateLlmsFiles({
    baseUrl: 'https://docs.example',
    generatedAt: '2026-09-01T00:00:00Z',
    outDir,
    routesPaths: FIXTURE_PAGES.map(([routePath]) => routePath),
    sourceCommit: 'test-commit',
  });

  assert.equal(
    fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8'),
    robotsBefore
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8'),
    sitemapBefore
  );

  fs.rmSync(outDir, { recursive: true, force: true });
});
