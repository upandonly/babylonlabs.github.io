const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

const OUTPUT_FILES = ['llms.txt', 'llms-full.txt'];
const OBSOLETE_FILES = ['llms-ctx.txt', 'llms-sitemap.xml'];
const PLACEHOLDER_MARKERS = ['Placeholder content', '[Content available at'];

const SECTION_ORDER = [
  'Trustless Bitcoin Vault',
  'Bitcoin Staking',
  'Babylon Genesis',
  'Developers',
  'Operators',
  'API Reference',
  'Guides',
  'Other Documentation',
];

function normalizePathname(value) {
  const pathname = new URL(value, 'https://docs.babylonlabs.io').pathname;
  if (pathname === '/') return pathname;
  return `${pathname.replace(/\/+$/, '')}/`;
}

function routeToHtmlPath(outDir, routePath) {
  const pathname = decodeURIComponent(normalizePathname(routePath));
  if (pathname === '/') return path.join(outDir, 'index.html');
  return path.join(outDir, pathname.replace(/^\//, ''), 'index.html');
}

function routeToMarkdownPath(outDir, routePath) {
  return path.join(
    path.dirname(routeToHtmlPath(outDir, routePath)),
    'index.md'
  );
}

function findBuiltRoutePaths(outDir) {
  const routePaths = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.name !== 'index.html') continue;

      const relativeDirectory = path.relative(outDir, directory);
      routePaths.push(
        normalizePathname(
          relativeDirectory
            ? `/${relativeDirectory.split(path.sep).join('/')}/`
            : '/'
        )
      );
    }
  }

  visit(outDir);
  return routePaths;
}

function sectionForPath(routePath) {
  const pathname = normalizePathname(routePath);

  if (pathname.startsWith('/trustless-bitcoin-vault/')) {
    return 'Trustless Bitcoin Vault';
  }
  if (
    pathname.startsWith('/guides/overview/bitcoin_staking/') ||
    pathname.startsWith('/developers/bitcoin_staking/') ||
    pathname.startsWith('/stakers/')
  ) {
    return 'Bitcoin Staking';
  }
  if (
    pathname.startsWith('/guides/overview/babylon_genesis/') ||
    pathname.startsWith('/developers/babylon_genesis_chain/') ||
    pathname.startsWith('/operators/babylon_node/')
  ) {
    return 'Babylon Genesis';
  }
  if (pathname.startsWith('/developers/')) return 'Developers';
  if (pathname.startsWith('/operators/')) return 'Operators';
  if (pathname.startsWith('/api/')) return 'API Reference';
  if (pathname.startsWith('/guides/')) return 'Guides';
  return 'Other Documentation';
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

function truncateText(value, maximumLength = 240) {
  const text = cleanText(value);
  if (text.length <= maximumLength) return text;

  const shortened = text.slice(0, maximumLength - 1);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 0 ? lastSpace : undefined)}…`;
}

function createTurndownService() {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    headingStyle: 'atx',
  });

  service.remove(['button', 'script', 'style', 'svg']);
  return service;
}

function htmlFragmentToMarkdown(html) {
  return createTurndownService()
    .turndown(html || '')
    .replace(/^#{1,6}\s+/gm, (heading) => `##${heading}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractRemoteMarkdown(outDir, routePath) {
  const pathname = normalizePathname(routePath);
  const relativePath = pathname.replace(/^\//, '').replace(/\/$/, '');
  const directories = [
    path.join(outDir, 'remote-docs', path.dirname(relativePath)),
    path.join(outDir, 'remote-docs', relativePath),
  ];
  const basename = path.basename(relativePath);

  const candidates = directories
    .filter((directory) => fs.existsSync(directory))
    .flatMap((directory) =>
      fs
        .readdirSync(directory)
        .filter(
          (fileName) =>
            fileName === `${basename}.html` ||
            (fileName.startsWith(`${basename}-version-`) &&
              fileName.endsWith('.html'))
        )
        .map((fileName) => ({ directory, fileName }))
    )
    .sort((left, right) =>
      path
        .join(left.directory, left.fileName)
        .localeCompare(path.join(right.directory, right.fileName))
    );

  return candidates
    .map(({ directory, fileName }) => {
      const remoteHtml = fs.readFileSync(
        path.join(directory, fileName),
        'utf8'
      );
      const remotePage = cheerio.load(remoteHtml);
      const remoteArticle = remotePage('article').first();
      remoteArticle.find('h1').first().remove();

      const markdown = htmlFragmentToMarkdown(remoteArticle.html());
      if (!markdown) return '';
      if (candidates.length === 1) return markdown;

      const version = fileName
        .slice(`${basename}-version-`.length, -'.html'.length)
        .replace(/-/g, ' ');
      return `### Remote documentation version: ${version}\n\n${markdown}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function extractPage(outDir, routePath, baseUrl) {
  const htmlPath = routeToHtmlPath(outDir, routePath);
  if (!fs.existsSync(htmlPath)) return null;

  const html = fs.readFileSync(htmlPath, 'utf8');
  const $ = cheerio.load(html);
  const content = $('.theme-doc-markdown').first();
  if (content.length === 0) return null;

  const title = cleanText(
    content.find('h1').first().text() ||
      $('meta[property="og:title"]').attr('content') ||
      $('title').text()
  );
  if (!title) return null;

  const description = truncateText(
    $('meta[name="description"]').attr('content') ||
      content.find('p').first().text() ||
      `Babylon documentation for ${title}`
  );

  content.find('h1').first().remove();
  content
    .find(
      'button, script, style, svg, .hash-link, .theme-admonition-icon, ' +
        '.openapi-tabs__code-container'
    )
    .remove();

  const localMarkdown = htmlFragmentToMarkdown(content.html());
  const remoteMarkdown = extractRemoteMarkdown(outDir, routePath);
  const markdown = [localMarkdown, remoteMarkdown].filter(Boolean).join('\n\n');
  if (!markdown) return null;

  const pathname = normalizePathname(routePath);
  const markdownPathname = `${pathname}index.md`;
  return {
    description,
    markdown,
    markdownPathname,
    markdownUrl: new URL(markdownPathname, baseUrl).toString(),
    pathname,
    section: sectionForPath(pathname),
    title,
    url: new URL(pathname, baseUrl).toString(),
  };
}

function getGitValue(args, fallback) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function resolveProvenance(options = {}) {
  const sourceCommit =
    options.sourceCommit ||
    process.env.LLMS_SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    getGitValue(['rev-parse', 'HEAD'], 'unknown');
  const generatedAt =
    options.generatedAt ||
    process.env.LLMS_SOURCE_DATE ||
    getGitValue(['show', '-s', '--format=%cI', sourceCommit], null) ||
    getGitValue(['show', '-s', '--format=%cI', 'HEAD'], 'unknown');

  return { generatedAt, sourceCommit };
}

function countWords(content) {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function metadataComment(pages, provenance) {
  const wordCount = pages.reduce(
    (total, page) => total + countWords(page.markdown),
    0
  );
  return `<!-- LLMS_METADATA ${JSON.stringify({
    documentCount: pages.length,
    generatedAt: provenance.generatedAt,
    sourceCommit: provenance.sourceCommit,
    wordCount,
  })} -->`;
}

function formatIndex(pages, baseUrl, provenance, sectionFiles) {
  const lines = [
    '# Babylon Labs Documentation',
    '',
    '> Canonical Babylon documentation for agents, developers, operators, and users.',
    '',
    metadataComment(pages, provenance),
    '',
    '## Full context',
    '',
    `- [Complete documentation context](${new URL(
      '/llms-full.txt',
      baseUrl
    )}): All indexed documentation in one file.`,
    '',
    '## Section indexes',
    '',
  ];

  for (const sectionFile of sectionFiles) {
    lines.push(
      `- [${sectionFile.section}](${new URL(
        sectionFile.pathname,
        baseUrl
      )}): ` + `${sectionFile.documentCount} documents.`
    );
  }

  for (const section of SECTION_ORDER) {
    const sectionPages = pages.filter((page) => page.section === section);
    if (sectionPages.length === 0) continue;

    lines.push('', `## ${section}`, '');
    for (const page of sectionPages) {
      lines.push(`- [${page.title}](${page.markdownUrl}): ${page.description}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatContext(pages, baseUrl, provenance, title, description) {
  const lines = [
    `# ${title}`,
    '',
    `> ${description}`,
    '',
    metadataComment(pages, provenance),
    '',
    `Index: ${new URL('/llms.txt', baseUrl)}`,
  ];

  for (const page of pages) {
    lines.push(
      '',
      `## [${page.title}](${page.url})`,
      '',
      `Markdown: ${page.markdownUrl}`,
      '',
      page.markdown
    );
  }

  return `${lines.join('\n')}\n`;
}

function formatPage(page) {
  return [
    `# ${page.title}`,
    '',
    `> ${page.description}`,
    '',
    `Canonical page: ${page.url}`,
    '',
    page.markdown,
    '',
  ].join('\n');
}

function injectDiscoveryLinks(html, page, baseUrl) {
  if (html.includes('data-llms-discovery="true"')) return html;

  const tags = [
    `<link data-llms-discovery="true" rel="alternate" type="text/markdown" href="${page.markdownUrl}">`,
    `<link data-llms-discovery="true" rel="describedby" href="${new URL(
      '/llms.txt',
      baseUrl
    )}">`,
  ].join('');

  return html.replace('</head>', `${tags}</head>`);
}

function assertGeneratedContent(files, pages) {
  if (pages.length === 0) {
    throw new Error('The LLM generator found no documentation pages.');
  }

  for (const outputName of OUTPUT_FILES) {
    const content = files[outputName];
    if (!content || content.trim().length === 0) {
      throw new Error(`${outputName} is empty.`);
    }
    for (const marker of PLACEHOLDER_MARKERS) {
      if (content.includes(marker)) {
        throw new Error(
          `${outputName} contains the forbidden marker: ${marker}`
        );
      }
    }
  }
}

function generateLlmsFiles({
  baseUrl = 'https://docs.babylonlabs.io',
  outDir,
  routesPaths,
  ...provenanceOptions
}) {
  const provenance = resolveProvenance(provenanceOptions);
  const pages = [
    ...new Set(
      [...routesPaths, ...findBuiltRoutePaths(outDir)].map(normalizePathname)
    ),
  ]
    .map((routePath) => extractPage(outDir, routePath, baseUrl))
    .filter(Boolean)
    .sort((left, right) => left.pathname.localeCompare(right.pathname));

  const sectionFiles = SECTION_ORDER.map((section) => ({
    pages: pages.filter((page) => page.section === section),
    pathname: `/llms-sections/${slugify(section)}.txt`,
    section,
  }))
    .filter(({ pages: sectionPages }) => sectionPages.length > 0)
    .map(({ pages: sectionPages, pathname, section }) => ({
      content: formatContext(
        sectionPages,
        baseUrl,
        provenance,
        `Babylon Labs ${section} Documentation`,
        `Complete ${section} documentation in Markdown.`
      ),
      documentCount: sectionPages.length,
      pathname,
      section,
    }));

  const files = {
    'llms.txt': formatIndex(pages, baseUrl, provenance, sectionFiles),
    'llms-full.txt': formatContext(
      pages,
      baseUrl,
      provenance,
      'Babylon Labs Complete Documentation',
      'Complete Babylon documentation in Markdown.'
    ),
  };

  assertGeneratedContent(files, pages);

  for (const obsoleteFile of OBSOLETE_FILES) {
    fs.rmSync(path.join(outDir, obsoleteFile), { force: true });
  }
  for (const [outputName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, outputName), content, 'utf8');
  }
  for (const sectionFile of sectionFiles) {
    const outputPath = path.join(
      outDir,
      sectionFile.pathname.replace(/^\//, '')
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, sectionFile.content, 'utf8');
  }
  for (const page of pages) {
    const markdownPath = routeToMarkdownPath(outDir, page.pathname);
    fs.writeFileSync(markdownPath, formatPage(page), 'utf8');

    const htmlPath = routeToHtmlPath(outDir, page.pathname);
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      injectDiscoveryLinks(html, page, baseUrl),
      'utf8'
    );
  }

  return { files, pages, provenance, sectionFiles };
}

module.exports = {
  OBSOLETE_FILES,
  OUTPUT_FILES,
  PLACEHOLDER_MARKERS,
  SECTION_ORDER,
  extractPage,
  findBuiltRoutePaths,
  generateLlmsFiles,
  normalizePathname,
  routeToHtmlPath,
  routeToMarkdownPath,
  sectionForPath,
};
