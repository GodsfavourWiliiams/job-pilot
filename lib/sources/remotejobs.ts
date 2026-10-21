import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

function searchKeywords(queries: string[], max: number): string[] {
  const words = queries.map((query) => query.toLowerCase()
    .replace(/front[ -]?end/g, 'frontend')
    .replace(/\b(?:developer|engineer)\b/g, '')
    .replace(/\s+/g, ' ').trim())
    .filter((query) => query.length >= 3 && query !== 'ui');
  return [...new Set(words)].slice(0, max);
}

function normalize(item: Record<string, unknown>): SourceJob {
  const company = item.company && typeof item.company === 'object' ? item.company as Record<string, unknown> : {};
  const link = String(item.url ?? '');
  const location = item.location_normalization && typeof item.location_normalization === 'object'
    ? item.location_normalization as Record<string, unknown> : {};
  const rawLocation = String(item.location ?? 'Unknown');
  const countries = Array.isArray(location.allowed_countries) ? location.allowed_countries.filter((code): code is string => typeof code === 'string') : [];
  const excluded = Array.isArray(location.excluded_countries) ? location.excluded_countries.filter((code): code is string => typeof code === 'string') : [];
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  const names = (codes: string[]) => codes.map((code) => /^[A-Z]{2}$/i.test(code) ? display.of(code.toUpperCase()) ?? code : code);
  const normalizedLocation = countries.length ? names(countries).join(', ')
    : location.scope === 'worldwide' ? `Worldwide${excluded.length ? ` except ${names(excluded).join(', ')}` : ''}`
      : rawLocation;
  return { id: String(item.id ?? link), source: 'RemoteJobs.org', sourceUrl: link,
    applyUrl: String(item.apply_url ?? link), title: String(item.title ?? ''), company: String(company.name ?? ''),
    location: normalizedLocation,
    employment: String(item.type ?? (Array.isArray(item.employment_types) ? item.employment_types.join(', ') : '')),
    descriptionHtml: String(item.description ?? ''), publishedAt: String(item.posted_at ?? ''), expiryAt: '',
    seniority: [], timezoneRestrictions: [] };
}

async function fetchJobs(config: SearchConfig, queries: string[]): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const terms = searchKeywords(queries, config.sources.remotejobs.maxQueries);
  const jobs = new Map<string, SourceJob>();
  const warnings: string[] = [];
  let successfulRequests = 0;
  for (const term of terms) {
    for (let page = 0; page < config.sources.remotejobs.pagesPerQuery; page++) {
      const url = new URL(config.sources.remotejobs.endpoint);
      url.searchParams.set('q', term);
      url.searchParams.set('category', 'programming');
      url.searchParams.set('limit', String(config.sources.remotejobs.pageSize));
      url.searchParams.set('offset', String(page * config.sources.remotejobs.pageSize));
      try {
        const data = await getJson(url.toString()) as { data?: Record<string, unknown>[]; pagination?: { has_more?: boolean } };
        if (!Array.isArray(data.data)) throw new Error('Unexpected jobs response');
        successfulRequests++;
        for (const item of data.data) {
          const job = normalize(item);
          if (job.id && job.sourceUrl) jobs.set(job.id, job);
        }
        if (!data.pagination?.has_more || !data.data.length) break;
      } catch (error) {
        warnings.push(`${term} page ${page + 1}: ${String(error)}`);
        break;
      }
    }
  }
  if (!successfulRequests) throw new Error(`All RemoteJobs.org requests failed: ${warnings.join('; ') || 'no queries'}`);
  return { jobs: [...jobs.values()], warnings };
}

export const remotejobs: SourceAdapter = { id: 'remotejobs', fetch: fetchJobs };
