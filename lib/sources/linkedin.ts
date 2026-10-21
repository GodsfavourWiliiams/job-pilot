import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { extractJobPostingsFromHtml } from '../scrape-jsonld.ts';
import { htmlFrom } from './google.ts';
import type { SourceAdapter } from './types';

/** Public job cards contain a /jobs/view/ link even when their display HTML changes. */
export function linkedinJobLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/gi, '&'), 'https://www.linkedin.com');
      if (!/(?:^|\.)linkedin\.com$/i.test(url.hostname) || !/^\/jobs\/view\/[^/]+/i.test(url.pathname)) continue;
      url.search = ''; url.hash = '';
      links.add(url.toString());
    } catch { /* malformed card link */ }
  }
  return [...links];
}

async function fetchJobs(config: SearchConfig, queries: string[]): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const settings = config.sources.linkedin;
  const terms = [...new Set(queries.map((term) => term.toLowerCase()
    .replace(/front[ -]?end/g, 'frontend').replace(/\b(?:developer|engineer)\b/g, '').trim()))]
    .filter((term) => term.length > 2).slice(0, settings.maxQueries);
  const results = await Promise.allSettled(terms.flatMap((term) => settings.locations.map(async (location) => {
    const url = new URL(settings.searchEndpoint);
    url.searchParams.set('keywords', `remote ${term}`);
    url.searchParams.set('location', location);
    url.searchParams.set('f_WT', '2');
    url.searchParams.set('f_TPR', 'r604800');
    return linkedinJobLinks(await htmlFrom(url.toString()));
  })));
  const failedSearches = results.filter((result) => result.status === 'rejected');
  if (failedSearches.length === results.length) throw new Error(`All LinkedIn public searches failed: ${String((failedSearches[0] as PromiseRejectedResult).reason)}`);
  const pages = [...new Set(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))].slice(0, settings.maxPages);
  const jobs: SourceJob[] = [];
  let failedPages = 0;
  for (let index = 0; index < pages.length; index += 4) {
    const batch = await Promise.allSettled(pages.slice(index, index + 4).map(async (page) => extractJobPostingsFromHtml(await htmlFrom(page), page)));
    for (const result of batch) {
      if (result.status === 'rejected') { failedPages++; continue; }
      for (const posting of result.value) jobs.push({
        id: posting.pageUrl, source: 'LinkedIn', sourceUrl: posting.pageUrl, applyUrl: posting.pageUrl,
        title: posting.title, company: posting.company, location: posting.location,
        employment: posting.employment, descriptionHtml: posting.descriptionHtml,
        publishedAt: posting.publishedAt, expiryAt: posting.expiryAt,
        seniority: [], timezoneRestrictions: [],
      });
    }
  }
  return { jobs, warnings: [
    `${results.length} public searches; ${pages.length} job pages inspected; ${jobs.length} structured remote postings`,
    ...(failedSearches.length ? [`${failedSearches.length} searches failed`] : []),
    ...(failedPages ? [`${failedPages} job pages failed`] : []),
    ...(!pages.length ? ['LinkedIn returned no readable job links'] : []),
  ] };
}

export const linkedin: SourceAdapter = { id: 'linkedin', fetch: fetchJobs };
