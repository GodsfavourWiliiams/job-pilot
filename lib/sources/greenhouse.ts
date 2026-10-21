import type { SearchConfig } from '../config';
import { normaliseGreenhouse, type SourceJob } from '../normalise-source.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

async function fetchBoard(config: SearchConfig, board: SearchConfig['sources']['greenhouse']['boards'][number]): Promise<SourceJob[]> {
  const url = `${config.sources.greenhouse.apiBase}/${encodeURIComponent(board.token)}/jobs?content=true`;
  const data = await getJson(url) as { jobs?: Record<string, unknown>[] };
  if (!Array.isArray(data.jobs)) throw new Error(`${board.token}: missing jobs array`);
  return data.jobs.map((row) => normaliseGreenhouse(row, board))
    .filter((job) => /\b(?:remote|home[ -]?based|work from anywhere|distributed)\b/i.test(job.location));
}

async function fetchJobs(config: SearchConfig): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const boards = config.sources.greenhouse.boards;
  if (!boards.length) return { jobs: [], warnings: [] };
  const results = await Promise.allSettled(boards.map((board) => fetchBoard(config, board)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === boards.length) throw new Error(`All ${boards.length} Greenhouse boards failed: ${failures.map((result) => String(result.reason)).join('; ')}`);
  return {
    jobs: results.filter((result): result is PromiseFulfilledResult<SourceJob[]> => result.status === 'fulfilled').flatMap((result) => result.value),
    warnings: results.flatMap((result, index) => result.status === 'rejected' ? [`${boards[index].company}: ${String(result.reason)}`] : []),
  };
}

export const greenhouse: SourceAdapter = { id: 'greenhouse', fetch: fetchJobs };
