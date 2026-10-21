import type { SearchConfig } from '../config';
import { normaliseRemoteOk, type SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchJobs(config: SearchConfig): Promise<SourceJob[]> {
  const data = await getJson(config.sources.remoteok.endpoint);
  if (!Array.isArray(data)) throw new Error('Remote OK returned an unexpected response');
  return data.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && 'id' in row))
    .map(normaliseRemoteOk);
}

export const remoteOk: SourceAdapter = { id: 'remoteok', fetch: fetchJobs };
