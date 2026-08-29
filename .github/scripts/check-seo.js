#!/usr/bin/env node
/**
 * SEO guardrail check for greenleafclinic-web.
 *
 * Catches the class of bugs found during the Aug 28 2026 Semrush audit:
 *  - canonical / og:url / JSON-LD mainEntityOfPage not matching the page's
 *    real path (wrong slug or missing /blog/ or /kr/ prefix)
 *  - "publisher" MedicalClinic (LocalBusiness) structured data missing the
 *    required "address" field (the field Google/Semrush actually validate)
 *  - <title> tags that are too long for search result display
 *
 * By default only checks files passed as CLI args (used by CI to check just
 * the files touched in a push/PR, so the pre-existing backlog of older pages
 * doesn't block every future commit). Run with --all to scan the whole repo
 * (useful for periodic manual backlog audits).
 */
const fs = require('fs');
const path = require('path');

const TITLE_WARN_LEN = 60;
const TITLE_FAIL_LEN = 70;

const SKIP_FILES = new Set([
  'inner-page-template.html',
  'treatable-conditions-template.html',
]);

let errors = [];
let warnings = [];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name === 'index.html' && !SKIP_FILES.has(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function expectedUrl(relPath) {
  const dir = path.dirname(relPath);
  const isKr = relPath === 'kr' || relPath.startsWith('kr' + path.sep) || relPath.startsWith('kr/');
  const domain = isKr ? 'https://kr.greenleafclinic.ca' : 'https://greenleafclinic.ca';
  const urlPath = dir === '.' ? '/' : '/' + dir.split(path.sep).join('/') + '/';
  return domain + urlPath;
}

const args = process.argv.slice(2);
const scanAll = args.includes('--all');
const explicitFiles = args.filter(a => a !== '--all' && a.endsWith('index.html'));

let files;
if (scanAll || explicitFiles.length === 0) {
  files = walk(process.cwd());
} else {
  files = explicitFiles.filter(f => fs.existsSync(f) && !SKIP_FILES.has(path.basename(f)));
}

for (const file of files) {
  const relPath = path.relative(process.cwd(), file) || file;
  const html = fs.readFileSync(file, 'utf8');
  const expected = expectedUrl(relPath);

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (titleMatch) {
    const len = titleMatch[1].length;
    if (len > TITLE_FAIL_LEN) {
      errors.push(`${relPath}: title tag is ${len} chars (limit ${TITLE_FAIL_LEN}): "${titleMatch[1]}"`);
    } else if (len > TITLE_WARN_LEN) {
      warnings.push(`${relPath}: title tag is ${len} chars (recommended <= ${TITLE_WARN_LEN})`);
    }
  }

  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)">/);
  if (canonicalMatch && canonicalMatch[1] !== expected) {
    errors.push(`${relPath}: canonical is "${canonicalMatch[1]}" but expected "${expected}"`);
  }

  const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]+)">/);
  if (ogUrlMatch && ogUrlMatch[1] !== expected) {
    errors.push(`${relPath}: og:url is "${ogUrlMatch[1]}" but expected "${expected}"`);
  }

  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of ldMatches) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      errors.push(`${relPath}: invalid JSON-LD (${e.message})`);
      continue;
    }
    if (data.mainEntityOfPage && data.mainEntityOfPage !== expected) {
      errors.push(`${relPath}: JSON-LD mainEntityOfPage is "${data.mainEntityOfPage}" but expected "${expected}"`);
    }
    // Only the top-level entity (homepage's own @type, or the article's
    // "publisher") is required to carry a full address — that's what
    // Google/Semrush actually validate. author.worksFor is intentionally
    // left as a lightweight affiliation reference without address.
    const clinics = [];
    if (data['@type'] === 'MedicalClinic' || data['@type'] === 'LocalBusiness') clinics.push(data);
    if (data.publisher && (data.publisher['@type'] === 'MedicalClinic' || data.publisher['@type'] === 'LocalBusiness')) {
      clinics.push(data.publisher);
    }
    for (const node of clinics) {
      if (!node.address) {
        errors.push(`${relPath}: JSON-LD "${node.name || node['@type']}" is missing required "address" field`);
      }
    }
  }
}

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`::warning::${w}`);
}

if (errors.length) {
  console.log(`\n✗ ${errors.length} error(s) across ${files.length} file(s) checked:`);
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`\nSEO check failed. Fix the issues above before merging.`);
  process.exit(1);
} else {
  console.log(`\n✓ SEO check passed (${files.length} file(s) checked, ${warnings.length} warning(s)).`);
}
