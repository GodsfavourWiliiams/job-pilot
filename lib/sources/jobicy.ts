import type { SearchConfig } from '../config';
import { normaliseJobicy, type SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchJobs(config: SearchConfig): Promise<SourceJob[]> {
  const jobs: SourceJob[] = [];
  let cursor = '';
  for (let page = 0; page < Math.min(config.sources.jobicy.maxPages, 10); page++) {
    const url = new URL(config.sources.jobicy.endpoint);
    url.searchParams.set('industry', config.sources.jobicy.industry);
    url.searchParams.set('count', String(config.sources.jobicy.count));
    if (cursor) url.searchParams.set('cursor', cursor);
    const data = await getJson(url.toString()) as { success?: boolean; error?: string; jobs?: Record<string, unknown>[]; nextCursor?: string | null };
    if (data.success === false) throw new Error(`Jobicy: ${data.error ?? 'API request failed'}`);
    if (!Array.isArray(data.jobs)) throw new Error('Jobicy returned an unexpected response');
    jobs.push(...data.jobs.map(normaliseJobicy));
    if (!data.nextCursor || data.nextCursor === cursor) break;
    cursor = data.nextCursor;
  }
  return jobs;
}

export const jobicy: SourceAdapter = { id: 'jobicy', fetch: fetchJobs };
