import type { SearchConfig } from '../config';
import { normaliseHimalayas, type SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchJobs(config: SearchConfig, terms: string[]): Promise<SourceJob[]> {
  const headers: Record<string, string> = process.env.HIMALAYAS_API_KEY
    ? { Authorization: `Bearer ${process.env.HIMALAYAS_API_KEY}` } : {};
  const jobs: SourceJob[] = [];
  let succeeded = 0;
  for (const term of terms) {
    for (let page = 1; page <= Math.min(config.sources.himalayas.pagesPerQuery, 5); page++) {
      const url = new URL(config.sources.himalayas.searchEndpoint);
      url.searchParams.set('q', term);
      url.searchParams.set('sort', config.sources.himalayas.sort);
      url.searchParams.set('page', String(page));
      try {
        const data = await getJson(url.toString(), headers) as { jobs?: Record<string, unknown>[] };
        succeeded++;
        const rows = data.jobs ?? [];
        for (const item of rows) jobs.push(normaliseHimalayas(item));
        if (!rows.length) break;
      } catch (error) {
        if (succeeded === 0 && term === terms.at(-1)) throw error;
        break;
      }
    }
  }
  if (!succeeded) throw new Error('Himalayas requests failed');
  return jobs;
}

export const himalayas: SourceAdapter = { id: 'himalayas', fetch: fetchJobs };
