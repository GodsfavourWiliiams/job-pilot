import type { SearchConfig } from '../config';
import type { Store } from '../types';
import { himalayas } from './himalayas.ts';
import { greenhouse } from './greenhouse.ts';
import { jobicy } from './jobicy.ts';
import { remoteOk } from './remote-ok.ts';
import { remotive } from './remotive.ts';
import { google } from './google.ts';
import { arbeitnow } from './arbeitnow.ts';
import { weworkremotely } from './weworkremotely.ts';
import { themuse } from './themuse.ts';
import { remotejobs } from './remotejobs.ts';
import { linkedin } from './linkedin.ts';
import { bluesky } from './bluesky.ts';
import { xposts } from './x-posts.ts';
import type { SourceAdapter } from './types';

/** Register one adapter here and one config entry when adding a source. */
export const sourceAdapters: SourceAdapter[] = [himalayas, remotive, jobicy, remoteOk, greenhouse, google, arbeitnow, weworkremotely, themuse, remotejobs, linkedin, bluesky, xposts];

export function enabledAdapters(config: SearchConfig, disabledSources: string[] = [], sourceRuns: Store['sourceRuns'] = {}, now = Date.now()): SourceAdapter[] {
  return sourceAdapters.filter((adapter) => {
    if (!config.sources[adapter.id].enabled || disabledSources.includes(adapter.id)) return false;
    const lastRun = Date.parse(sourceRuns[adapter.id]?.lastRunAt ?? '');
    const error = sourceRuns[adapter.id]?.error ?? '';
    const accessBlocked = /\b(?:HTTP 403|HTTP 401|HTTP 429|challenge|consent redirect)\b/i.test(error);
    const minutes = accessBlocked ? Math.max(config.schedule.sourceCooldownMinutes[adapter.id], 360)
      : error ? Math.min(config.schedule.sourceCooldownMinutes[adapter.id], 10)
        : config.schedule.sourceCooldownMinutes[adapter.id];
    const cooldown = minutes * 60_000;
    return !Number.isFinite(lastRun) || now - lastRun >= cooldown;
  });
}
