import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { extractJobPostingsFromHtml } from '../scrape-jsonld.ts';
import type { SourceAdapter } from './types';

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, dec: string) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)));
}

export function publicPage(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || host.includes('[') || !host.includes('.') || /^(?:localhost|\d+\.\d+\.\d+\.\d+)$/.test(host) || /(?:^|\.)(?:local|internal|test|google\.com|googleusercontent\.com|youtube\.com|facebook\.com|instagram\.com)$/.test(host)) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

/** Extract only result anchors that actually wrap a Google result heading. */
export function googleResultLinks(html: string): string[] {
  const links: string[] = [];
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/<h3\b[^>]*>[\s\S]*?<\/h3>/i.test(anchor[2])) continue;
    const href = anchor[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const raw = decodeHtml(href);
    let target = raw;
    if (raw.startsWith('/url?')) {
      const redirect = new URL(raw, 'https://www.google.com');
      target = redirect.searchParams.get('q') || redirect.searchParams.get('url') || '';
    }
    const page = publicPage(target);
    if (page && !links.includes(page)) links.push(page);
  }
  return links;
}

export async function htmlFrom(url: string, googleSearch = false): Promise<string> {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; JobPilot/1.0)', accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get('location');
      if (!location) throw new Error(`${new URL(current).hostname}: HTTP ${response.status} without location`);
      const next = new URL(location, current);
      const allowed = googleSearch
        ? /^([a-z0-9-]+\.)*google\.com$/i.test(next.hostname) && next.protocol === 'https:'
        : Boolean(publicPage(next.toString()));
      if (!allowed) throw new Error(`${new URL(current).hostname}: redirect to ${next.hostname} rejected`);
      if (/^\/sorry\b|^\/consent\b/i.test(next.pathname) || next.hostname.startsWith('consent.')) throw new Error(`${new URL(current).hostname}: Google challenge or consent redirect`);
      current = next.toString();
      continue;
    }
    if (!response.ok) throw new Error(`${new URL(current).hostname}: HTTP ${response.status}`);
    const type = response.headers?.get('content-type') || '';
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`${new URL(current).hostname}: unexpected content type`);
    const html = await response.text();
    if (html.length > 3_000_000) throw new Error(`${new URL(current).hostname}: page too large`);
    return html;
  }
  throw new Error(`${new URL(url).hostname}: too many redirects`);
}

async function fetchJobs(config: SearchConfig, queries: string[]): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const selected = queries.slice(0, config.sources.google.maxQueries);
  const searchResults = await Promise.allSettled(selected.map(async (query) => {
    const url = new URL(config.sources.google.searchEndpoint);
    url.searchParams.set('q', `remote ${query} jobs apply`);
    url.searchParams.set('num', '20');
    url.searchParams.set('filter', '0');
    const html = await htmlFrom(url.toString(), true);
    if (/unusual traffic|our systems have detected|recaptcha|consent\.google\.com/i.test(html)) throw new Error('Google returned a challenge or consent page');
    return googleResultLinks(html);
  }));
  const failedSearches = searchResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failedSearches.length === selected.length) throw new Error(`All Google searches failed: ${failedSearches.map((x) => String(x.reason)).join('; ')}`);
  const priority = (url: string): number => {
    const host = new URL(url).hostname;
    if (/(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com)$/.test(host)) return 0;
    if (/(?:indeed\.com|linkedin\.com|glassdoor\.com)$/.test(host)) return 2;
    return 1;
  };
  const pages = [...new Set(searchResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []))]
    .sort((a, b) => priority(a) - priority(b)).slice(0, config.sources.google.maxPages);
  const jobs: SourceJob[] = [];
  let failedPages = 0;
  // Bounded batches keep one blocked page from exhausting the entire scan.
  for (let i = 0; i < pages.length; i += 4) {
    const results = await Promise.allSettled(pages.slice(i, i + 4).map(async (page) => extractJobPostingsFromHtml(await htmlFrom(page), page)));
    results.forEach((result) => {
      if (result.status === 'rejected') { failedPages++; return; }
      for (const posting of result.value) {
        const url = publicPage(posting.pageUrl);
        if (!url) continue;
        jobs.push({ id: url, source: 'Google', sourceUrl: url, applyUrl: url, title: posting.title, company: posting.company,
          location: posting.location, employment: posting.employment, descriptionHtml: posting.descriptionHtml,
          publishedAt: posting.publishedAt, expiryAt: posting.expiryAt, seniority: [], timezoneRestrictions: [] });
      }
    });
  }
  const warnings = [
    `${selected.length} searches; ${pages.length} result pages inspected; ${jobs.length} structured remote postings`,
    ...(failedSearches.length ? [`${failedSearches.length} Google searches failed`] : []),
    ...(failedPages ? [`${failedPages} destination pages failed`] : []),
    ...(!pages.length ? ['Google returned no extractable result links; its HTML may have changed or access may be limited'] : []),
  ];
  return { jobs, warnings };
}

export const google: SourceAdapter = { id: 'google', fetch: fetchJobs };
