#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  OBSOLETE_FILES,
  OUTPUT_FILES,
  PLACEHOLDER_MARKERS,
  extractPage,
  findBuiltRoutePaths,
  normalizePathname,
  routeToHtmlPath,
} = require('../plugins/llms/generator.cjs');

function fail(message) {
  throw new Error(`[llms validation] ${message}`);
}

function readRequiredFile(outDir, fileName) {
  const filePath = path.join(outDir, fileName);
  if (!fs.existsSync(filePath)) fail(`${fileName} is missing.`);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) fail(`${fileName} is empty.`);
  return content;
}

function validateBuild(outDir) {
  const contents = Object.fromEntries(
    OUTPUT_FILES.map((fileName) => [
      fileName,
      readRequiredFile(outDir, fileName),
    ])
  );

  for (const [fileName, content] of Object.entries(contents)) {
    for (const marker of PLACEHOLDER_MARKERS) {
      if (content.includes(marker)) {
        fail(`${fileName} contains the forbidden marker: ${marker}`);
      }
    }
  }
  for (const obsoleteFile of OBSOLETE_FILES) {
    if (fs.existsSync(path.join(outDir, obsoleteFile))) {
      fail(`${obsoleteFile} must not exist.`);
    }
  }

  const markdownLinks = [
    ...contents['llms.txt'].matchAll(/\]\((https?:\/\/[^)]+\/index\.md)\)/g),
  ];
  if (markdownLinks.length === 0) fail('llms.txt has no page Markdown links.');

  const linkedRoutes = new Set();
  for (const [, markdownUrl] of markdownLinks) {
    const markdownPathname = new URL(markdownUrl).pathname;
    const routePath = normalizePathname(
      markdownPathname.replace(/index\.md$/, '')
    );
    linkedRoutes.add(routePath);

    const markdownPath = path.join(
      outDir,
      decodeURIComponent(markdownPathname).replace(/^\//, '')
    );
    if (!fs.existsSync(markdownPath)) fail(`${markdownPathname} is missing.`);

    const html = readRequiredFile(
      outDir,
      path.relative(outDir, routeToHtmlPath(outDir, routePath))
    );
    if (!html.includes('rel="alternate" type="text/markdown"')) {
      fail(`${routePath} has no Markdown alternate link.`);
    }
    if (!html.includes('rel="describedby"')) {
      fail(`${routePath} has no llms.txt discovery link.`);
    }
  }

  const documentationRoutes = new Set(
    findBuiltRoutePaths(outDir).filter((routePath) =>
      extractPage(outDir, routePath, 'https://docs.babylonlabs.io')
    )
  );
  const missingRoutes = [...documentationRoutes].filter(
    (routePath) => !linkedRoutes.has(routePath)
  );
  if (missingRoutes.length > 0) {
    fail(
      `llms.txt omits ${missingRoutes.length} documentation routes: ` +
        missingRoutes.slice(0, 5).join(', ')
    );
  }

  const result = {
    documentCount: linkedRoutes.size,
    fullBytes: Buffer.byteLength(contents['llms-full.txt']),
    indexBytes: Buffer.byteLength(contents['llms.txt']),
  };
  console.log(
    `[llms validation] ${result.documentCount} documents, ` +
      `${result.indexBytes} index bytes, ${result.fullBytes} full-context bytes.`
  );
  return result;
}

if (require.main === module) {
  validateBuild(path.resolve(process.argv[2] || 'build'));
}

module.exports = { validateBuild };
