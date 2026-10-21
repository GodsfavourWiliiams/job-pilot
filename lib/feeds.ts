import { effectiveQueries, type SearchConfig } from './config';
import { dedupeKey, eligibleLocation, findApplicationEmail, jobId, normaliseEmployment, plainText, scoreJob } from './match';
import { enabledAdapters } from './sources';
import type { SourceJob } from './normalise-source';
import type { Job, Preferences, Profile, Store } from './types';

export async function discoverJobs(profile: Profile, preferences: Preferences, config: SearchConfig, previousRuns: Store['sourceRuns']): Promise<{ jobs: Job[]; errors: string[]; sourceCount: number; skippedSources: number; sourceRuns: Store['sourceRuns'] }> {
  const configuredCount = Object.entries(config.sources).filter(([id, source]) => source.enabled && !preferences.disabledSources.includes(id)).length;
  if (!configuredCount) throw new Error('All job sources are disabled');
  const adapters = enabledAdapters(config, preferences.disabledSources, previousRuns);
  const queries = effectiveQueries(config, preferences, profile);
  const feeds = await Promise.allSettled(adapters.map((adapter) => adapter.fetch(config, queries)));
  const sourceRuns: Store['sourceRuns'] = {};
  const errors: string[] = [];
  const sourceJobs: { job: SourceJob; sourceId: string }[] = [];
  const runAt = new Date().toISOString();
  feeds.forEach((result, index) => {
    const adapter = adapters[index];
    if (result.status === 'fulfilled') {
      const fetched = Array.isArray(result.value) ? { jobs: result.value, warnings: [] } : result.value;
      sourceJobs.push(...fetched.jobs.map((job) => ({ job, sourceId: adapter.id })));
      sourceRuns[adapter.id] = { lastRunAt: runAt, lastSuccessAt: runAt, jobCount: fetched.jobs.length, matchedCount: 0, filtered: {}, error: '', warning: fetched.warnings.join('; ') };
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${config.sources[adapter.id].name}: ${message}`);
      sourceRuns[adapter.id] = { lastRunAt: runAt, lastSuccessAt: '', jobCount: 0, matchedCount: 0, filtered: {}, error: message };
    }
  });
  const seen = new Set<string>();
  const jobs: Job[] = [];
  const filtered = (sourceId: string, reason: string) => {
    const counts = sourceRuns[sourceId].filtered;
    counts[reason] = (counts[reason] ?? 0) + 1;
  };
  for (const { job: source, sourceId } of sourceJobs) {
    if (!source.id || !source.title || !source.company || !source.sourceUrl || !source.applyUrl) { filtered(sourceId, 'missing required fields'); continue; }
    if (source.expiryAt && Date.parse(source.expiryAt) < Date.now()) { filtered(sourceId, 'expired'); continue; }
    const key = dedupeKey(source.title, source.company);
    if (seen.has(key)) { filtered(sourceId, 'duplicate in scan'); continue; }
    const description = plainText(source.descriptionHtml).slice(0, 16_000);
    const employment: Job['employment'] = normaliseEmployment(source.employment) ?? 'Unknown';
    const partial = {
      title: source.title, location: source.location,
      employment, description, seniority: source.seniority, timezoneRestrictions: source.timezoneRestrictions,
    };
    const match = scoreJob(partial, profile, preferences, config);
    if (match.score < preferences.minScore) { filtered(sourceId, match.reasons[0] ?? 'below match score'); continue; }
    seen.add(key);
    sourceRuns[sourceId].matchedCount++;
    jobs.push({
      id: jobId(source.source, source.id), source: source.source,
      sourceUrl: source.sourceUrl, applyUrl: source.applyUrl,
      title: source.title, company: source.company, seniority: source.seniority, level: match.level, timezoneRestrictions: source.timezoneRestrictions,
      location: source.location, locationVerified: eligibleLocation(source.location, profile.country, config.location), employment: partial.employment,
      description, publishedAt: source.publishedAt,
      applicationEmail: source.source === 'Himalayas' && !source.applyUrl.toLowerCase().startsWith('mailto:')
        ? '' : findApplicationEmail(source.applyUrl, source.descriptionHtml),
      score: match.score, matchReasons: match.reasons,
      status: 'pending', addedAt: new Date().toISOString(),
    });
  }
  return { jobs: jobs.sort((a, b) => b.score - a.score), errors, sourceCount: adapters.length, skippedSources: configuredCount - adapters.length, sourceRuns };
}
