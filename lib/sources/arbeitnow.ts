import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchJobs(config: SearchConfig): Promise<SourceJob[]> {
  const jobs: SourceJob[] = [];
  for (let page = 1; page <= config.sources.arbeitnow.maxPages; page++) {
    const url = new URL(config.sources.arbeitnow.endpoint);
    url.searchParams.set('page', String(page));
    const data = await getJson(url.toString()) as { data?: Record<string, unknown>[] };
    if (!Array.isArray(data.data)) throw new Error('Arbeitnow returned an unexpected response');
    for (const item of data.data) {
      if (item.remote !== true) continue;
      const sourceUrl = String(item.url ?? '');
      jobs.push({ id: String(item.slug ?? sourceUrl), source: 'Arbeitnow', sourceUrl, applyUrl: sourceUrl,
        title: String(item.title ?? ''), company: String(item.company_name ?? ''), location: String(item.location ?? 'Unknown'),
        employment: Array.isArray(item.job_types) ? item.job_types.join(', ') : '', descriptionHtml: String(item.description ?? ''),
        publishedAt: typeof item.created_at === 'number' ? new Date(item.created_at * 1000).toISOString() : '',
        expiryAt: '', seniority: [], timezoneRestrictions: [] });
    }
    if (data.data.length === 0) break;
  }
  return jobs;
}

export const arbeitnow: SourceAdapter = { id: 'arbeitnow', fetch: fetchJobs };
