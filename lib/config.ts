import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CareerLevel, Preferences, Profile } from './types';

interface RoleFocus {
  aliases: string[];
  baseQueries: string[];
  cvSkillQueries: Record<string, string[]>;
}

export interface SearchConfig {
  version: number;
  sources: {
    himalayas: { enabled: boolean; name: string; homepage: string; searchEndpoint: string; sort: string; pagesPerQuery: number };
    remotive: { enabled: boolean; name: string; homepage: string; endpoint: string; category: string; limit: number };
    jobicy: { enabled: boolean; name: string; homepage: string; endpoint: string; industry: string; count: number; maxPages: number };
    remoteok: { enabled: boolean; name: string; homepage: string; endpoint: string };
    greenhouse: { enabled: boolean; name: string; homepage: string; apiBase: string; boards: { token: string; company: string }[] };
    google: { enabled: boolean; name: string; homepage: string; searchEndpoint: string; maxQueries: number; maxPages: number };
    arbeitnow: { enabled: boolean; name: string; homepage: string; endpoint: string; maxPages: number };
    weworkremotely: { enabled: boolean; name: string; homepage: string; feeds: string[] };
    themuse: { enabled: boolean; name: string; homepage: string; endpoint: string; location: string; maxPages: number };
    remotejobs: { enabled: boolean; name: string; homepage: string; endpoint: string; maxQueries: number; pagesPerQuery: number; pageSize: number };
    linkedin: { enabled: boolean; name: string; homepage: string; searchEndpoint: string; locations: string[]; maxQueries: number; maxPages: number };
    bluesky: { enabled: boolean; name: string; homepage: string; searchEndpoint: string; maxQueries: number; postsPerQuery: number; maxLinkedPages: number };
    xposts: { enabled: boolean; name: string; homepage: string; searchEndpoint: string; maxQueries: number; postsPerQuery: number; maxLinkedPages: number };
  };
  roles: { queries: string[]; focuses: Record<string, RoleFocus>; levelTerms: Record<Exclude<CareerLevel, 'unspecified'>, string[]> };
  location: {
    worldwideTerms: string[];
    countryAliases: Record<string, string[]>;
    utcOffsetMinutesByCountry: Record<string, number>;
  };
  schedule: { checkEveryMinutes: number; sourceCooldownMinutes: Record<keyof SearchConfig['sources'], number> };
  defaults: Omit<Preferences, 'searchTerms'>;
}

/** This is the only boundary to replace when settings come from a database or API. */
export async function loadSearchConfig(): Promise<SearchConfig> {
  const file = path.join(process.cwd(), 'config', 'search.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as SearchConfig;
  if (parsed.version !== 1 || !parsed.sources?.himalayas || !parsed.sources?.remotive || !parsed.sources?.jobicy || !parsed.sources?.remoteok || !parsed.sources?.greenhouse || !parsed.sources?.google || !parsed.sources?.arbeitnow || !parsed.sources?.weworkremotely || !parsed.sources?.themuse || !parsed.sources?.remotejobs || !parsed.sources?.linkedin || !parsed.sources?.bluesky || !parsed.sources?.xposts || !parsed.roles?.queries?.length || !parsed.roles.focuses || !parsed.roles.levelTerms || !parsed.location || !parsed.schedule) {
    throw new Error('Invalid config/search.json');
  }
  for (const endpoint of [parsed.sources.himalayas.searchEndpoint, parsed.sources.remotive.endpoint, parsed.sources.jobicy.endpoint, parsed.sources.remoteok.endpoint, parsed.sources.greenhouse.apiBase, parsed.sources.google.searchEndpoint, parsed.sources.arbeitnow.endpoint, parsed.sources.themuse.endpoint, parsed.sources.remotejobs.endpoint, parsed.sources.linkedin.searchEndpoint, parsed.sources.bluesky.searchEndpoint, parsed.sources.xposts.searchEndpoint]) {
    if (!endpoint.startsWith('https://')) throw new Error('Job source endpoints must use HTTPS');
  }
  if (parsed.schedule.checkEveryMinutes < 1 || Object.keys(parsed.sources).some((id) => parsed.schedule.sourceCooldownMinutes?.[id as keyof SearchConfig['sources']] < 1)) throw new Error('Scan schedule must be positive');
  if (parsed.sources.jobicy.count < 1 || parsed.sources.jobicy.count > 200 || parsed.sources.jobicy.maxPages < 1 || parsed.sources.jobicy.maxPages > 10) throw new Error('Invalid Jobicy page settings');
  if (parsed.sources.google.maxQueries < 1 || parsed.sources.google.maxQueries > 10 || parsed.sources.google.maxPages < 1 || parsed.sources.google.maxPages > 30 || parsed.sources.arbeitnow.maxPages < 1 || parsed.sources.arbeitnow.maxPages > 10) throw new Error('Invalid scraper page settings');
  if (parsed.sources.themuse.maxPages < 1 || parsed.sources.themuse.maxPages > 30 || !parsed.sources.themuse.location) throw new Error('Invalid The Muse settings');
  if (parsed.sources.remotejobs.maxQueries < 1 || parsed.sources.remotejobs.maxQueries > 8 || parsed.sources.remotejobs.pagesPerQuery < 1 || parsed.sources.remotejobs.pagesPerQuery > 5 || parsed.sources.remotejobs.pageSize < 1 || parsed.sources.remotejobs.pageSize > 50) throw new Error('Invalid RemoteJobs.org settings');
  if (parsed.sources.linkedin.maxQueries < 1 || parsed.sources.linkedin.maxQueries > 8 || parsed.sources.linkedin.maxPages < 1 || parsed.sources.linkedin.maxPages > 30 || !Array.isArray(parsed.sources.linkedin.locations) || !parsed.sources.linkedin.locations.length) throw new Error('Invalid LinkedIn search settings');
  if (parsed.sources.bluesky.maxQueries < 1 || parsed.sources.bluesky.maxQueries > 8 || parsed.sources.bluesky.postsPerQuery < 1 || parsed.sources.bluesky.postsPerQuery > 100 || parsed.sources.bluesky.maxLinkedPages < 1 || parsed.sources.bluesky.maxLinkedPages > 40) throw new Error('Invalid Bluesky search settings');
  if (parsed.sources.xposts.maxQueries < 1 || parsed.sources.xposts.maxQueries > 8 || parsed.sources.xposts.postsPerQuery < 10 || parsed.sources.xposts.postsPerQuery > 100 || parsed.sources.xposts.maxLinkedPages < 1 || parsed.sources.xposts.maxLinkedPages > 40) throw new Error('Invalid X search settings');
  if (!Array.isArray(parsed.sources.greenhouse.boards) || parsed.sources.greenhouse.boards.some((board) => !/^[a-z0-9-]+$/.test(board.token) || !board.company)) throw new Error('Invalid Greenhouse board catalog');
  if (!Array.isArray(parsed.sources.weworkremotely.feeds) || !parsed.sources.weworkremotely.feeds.length || parsed.sources.weworkremotely.feeds.some((feed) => !feed.startsWith('https://weworkremotely.com/') || !feed.endsWith('.rss'))) throw new Error('Invalid We Work Remotely feeds');
  return parsed;
}

export function effectiveQueries(config: SearchConfig, preferences: Preferences, profile: Profile): string[] {
  const desired = preferences.searchTerms.map((term) => term.trim()).filter(Boolean);
  const cv = profile.resumeText.toLowerCase();
  const selected = Object.values(config.roles.focuses).filter((focus) => {
    if (desired.length) return desired.some((term) => focus.aliases.some((alias) => term.toLowerCase().includes(alias)));
    return Object.keys(focus.cvSkillQueries).filter((skill) => cv.includes(skill.toLowerCase())).length >= 2
      || focus.aliases.some((alias) => cv.split('\n').slice(0, 4).join(' ').includes(alias.toLowerCase()));
  });
  if (!selected.length) return desired.length ? desired : config.roles.queries;
  const queries = [...desired];
  for (const focus of selected) {
    queries.push(...focus.baseQueries);
    for (const [skill, titles] of Object.entries(focus.cvSkillQueries)) {
      if (cv.includes(skill.toLowerCase())) queries.push(...titles);
    }
  }
  return [...new Set(queries.map((query) => query.toLowerCase()))];
}

export function sourceLinks(config: SearchConfig): { id: string; name: string; url: string; boards?: { company: string; url: string }[] }[] {
  return Object.entries(config.sources)
    .filter(([, source]) => source.enabled)
    .map(([id, source]) => ({ id, name: source.name, url: source.homepage,
      ...(id === 'greenhouse' ? { boards: config.sources.greenhouse.boards.map((board) => ({ company: board.company, url: `https://job-boards.greenhouse.io/${board.token}` })) } : {}),
    }));
}
