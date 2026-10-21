import type { SearchConfig } from '../config';
import { normaliseRemotive, type SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchJobs(config: SearchConfig): Promise<SourceJob[]> {
  const url = new URL(config.sources.remotive.endpoint);
  url.searchParams.set('category', config.sources.remotive.category);
  url.searchParams.set('limit', String(config.sources.remotive.limit));
  const data = await getJson(url.toString()) as { jobs?: Record<string, unknown>[] };
  return (data.jobs ?? []).map(normaliseRemotive);
}

export const remotive: SourceAdapter = { id: 'remotive', fetch: fetchJobs };
