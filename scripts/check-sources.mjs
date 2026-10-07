/**
 * Monitor public official pages, not the user's accounts or targeted offers.
 * A changed hash means the page needs review; it never verifies reward facts.
 * No credentials, Tavily account, or third-party API is needed for this script.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OFFICIAL_DOMAINS = ['chase.com', 'capitalone.com', 'bilt.com', 'biltrewards.com'];
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;

export function isOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      OFFICIAL_DOMAINS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function collectSourceUrls(catalog) {
  const urls = new Set();
  function visit(value, inSources = false) {
    if (typeof value === 'string') {
      if (inSources && isOfficialUrl(value)) {
        const url = new URL(value);
        url.hash = '';
        urls.add(url.href);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inSources));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      visit(child, inSources || /^(sources?|sourceUrls?|references?)$/i.test(key));
    }
  }
  visit(catalog);
  return [...urls].sort();
}

export function comparableText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchOfficialPage(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!isOfficialUrl(current)) throw new Error('redirect-outside-official-domains');
      const response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CardCompassSourceMonitor/1.0 (public credit-card benefit page change detection)',
          Accept: 'text/html, application/xhtml+xml, application/pdf, text/plain;q=0.9',
          'Accept-Language': 'en-US,en;q=0.8',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('redirect-without-location');
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`http-${response.status}`);
      }
      const type = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml|application\/pdf|text\/plain/i.test(type)) {
        await response.body?.cancel();
        throw new Error('unsupported-content-type');
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > MAX_BYTES) {
          controller.abort();
          throw new Error('page-too-large');
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      if (/application\/pdf/i.test(type)) {
        if (body.subarray(0, 5).toString() !== '%PDF-' || body.length < 100) throw new Error('insufficient-readable-content');
        // Hash the official document bytes without treating metadata changes as
        // verified policy changes. No PDF text parser or secret is needed.
        return { hash: createHash('sha256').update(body).digest('hex'), finalUrl: current, httpStatus: response.status, format: 'pdf-bytes' };
      }
      const html = body.toString('utf8');
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
      if (/access denied|just a moment|attention required|verify.*human|robot check/i.test(title)) {
        throw new Error('site-blocked-automated-fetch');
      }
      const text = comparableText(html);
      if (text.length < 100) throw new Error('insufficient-readable-content');
      return { hash: createHash('sha256').update(text).digest('hex'), finalUrl: current, httpStatus: response.status, format: 'normalized-text' };
    }
    throw new Error('too-many-redirects');
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSource(url, previous = {}, { fetchImpl = fetch, checkedAt = new Date().toISOString() } = {}) {
  try {
    const page = await fetchOfficialPage(url, fetchImpl);
    const changed = Boolean(previous.hash && previous.hash !== page.hash);
    return {
      url,
      status: !previous.hash ? 'first-check' : changed ? 'changed' : 'unchanged',
      checkedAt,
      lastSuccessfulAt: checkedAt,
      firstObservedAt: previous.firstObservedAt || checkedAt,
      ...page,
      // Keep the review flag until the maintainer explicitly clears it after
      // reviewing the page and factual catalog. An unchanged next run is not approval.
      needsReview: changed || previous.needsReview === true,
      changedAt: changed ? checkedAt : previous.changedAt || null,
    };
  } catch (error) {
    const safeError = error?.name === 'AbortError' ? 'request-timeout' :
      /^(http-\d{3}|redirect-outside-official-domains|redirect-without-location|unsupported-content-type|page-too-large|site-blocked-automated-fetch|insufficient-readable-content|too-many-redirects)$/.test(error?.message)
        ? error.message : 'network-or-fetch-error';
    return {
      url,
      status: 'unavailable',
      checkedAt,
      lastSuccessfulAt: previous.lastSuccessfulAt || null,
      firstObservedAt: previous.firstObservedAt || null,
      hash: previous.hash || null,
      needsReview: previous.needsReview === true,
      changedAt: previous.changedAt || null,
      error: safeError,
    };
  }
}

export async function run() {
  const catalogPath = path.join(ROOT, 'public/data/catalog.json');
  const outputPath = path.join(ROOT, 'public/data/source-status.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const urls = collectSourceUrls(catalog);
  if (!urls.length) throw new Error('No official source URLs found in public/data/catalog.json');
  let previous = { sources: [] };
  try {
    previous = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const checkedAt = new Date().toISOString();
  const previousByUrl = new Map((previous.sources || []).map((source) => [source.url, source]));
  const sources = [];
  for (let offset = 0; offset < urls.length; offset += 3) {
    sources.push(...await Promise.all(urls.slice(offset, offset + 3).map((url) =>
      checkSource(url, previousByUrl.get(url), { checkedAt }))));
  }
  const result = {
    schemaVersion: 1,
    checkedAt,
    method: 'normalized-page-text-or-pdf-bytes-sha256',
    disclaimer: '公开网页文本及 PDF 文件变化监测；不等于权益条款核验，也不包含账户定向优惠。动态页面和 PDF 元数据变化可能误报。',
    sources,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  const counts = sources.reduce((counts, source) => {
    counts[source.status] = (counts[source.status] || 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ checkedAt, sourceCount: sources.length, statuses: counts }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(`Source monitor failed: ${error.message}`);
    process.exitCode = 1;
  });
}
