import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';

export type SourceId = keyof SearchConfig['sources'];
export interface SourceAdapter {
  id: SourceId;
  fetch(config: SearchConfig, queries: string[]): Promise<SourceJob[] | { jobs: SourceJob[]; warnings: string[] }>;
}
