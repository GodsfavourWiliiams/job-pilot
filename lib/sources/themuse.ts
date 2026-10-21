import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => item && typeof item === 'object' ? String((item as Record<string, unknown>).name ?? '') : '').filter(Boolean) : [];
}

function normalize(item: Record<string, unknown>): SourceJob | null {
  const locations = names(item.locations);
  if (!locations.some((location) => /\bremote\b/i.test(location))) return null;
  const refs = item.refs && typeof item.refs === 'object' ? item.refs as Record<string, unknown> : {};
  const company = item.company && typeof item.company === 'object' ? item.company as Record<string, unknown> : {};
  const url = String(refs.landing_page ?? '');
  return { id: String(item.id ?? url), source: 'The Muse', sourceUrl: url, applyUrl: url,
    title: String(item.name ?? ''), company: String(company.name ?? ''), location: locations.join(', ') || 'Remote',
    employment: '', descriptionHtml: String(item.contents ?? ''), publishedAt: String(item.publication_date ?? ''),
    expiryAt: '', seniority: names(item.levels), timezoneRestrictions: [] };
}

async function fetchJobs(config: SearchConfig): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const pages = Array.from({ length: config.sources.themuse.maxPages }, (_, page) => page);
  const jobs: SourceJob[] = [];
  const warnings: string[] = [];
  for (let start = 0; start < pages.length; start += 3) {
    const results = await Promise.allSettled(pages.slice(start, start + 3).map(async (page) => {
      const url = new URL(config.sources.themuse.endpoint);
      url.searchParams.set('page', String(page));
      url.searchParams.set('location', config.sources.themuse.location);
      url.searchParams.set('descending', 'true');
      const data = await getJson(url.toString()) as { results?: Record<string, unknown>[]; page_count?: number };
      if (!Array.isArray(data.results)) throw new Error('The Muse returned an unexpected response');
      return data;
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') { warnings.push(`Page ${start + index}: ${String(result.reason)}`); return; }
      jobs.push(...result.value.results!.map(normalize).filter((job): job is SourceJob => job !== null));
    });
    if (results.some((result) => result.status === 'fulfilled' && (result.value.results!.length === 0 || (typeof result.value.page_count === 'number' && start + 3 >= result.value.page_count)))) break;
  }
  if (!jobs.length && warnings.length === pages.length) throw new Error(`All The Muse pages failed: ${warnings.join('; ')}`);
  return { jobs, warnings };
}

export const themuse: SourceAdapter = { id: 'themuse', fetch: fetchJobs };
