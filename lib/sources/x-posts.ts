import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { extractJobPostingsFromHtml } from '../scrape-jsonld.ts';
import { htmlFrom, publicPage } from './google.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

type XPost = { text?: string; entities?: { urls?: { expanded_url?: string; unwound_url?: string }[] } };

export function jobLinksFromXPosts(posts: XPost[]): string[] {
  const links = new Set<string>();
  for (const post of posts) {
    if (!/\b(?:hiring|apply|opening|vacanc(?:y|ies)|job)\b/i.test(post.text ?? '')) continue;
    for (const link of post.entities?.urls ?? []) {
      const url = publicPage(link.unwound_url ?? link.expanded_url ?? '');
      if (url && !/(?:^|\.)(?:x\.com|twitter\.com|t\.co)$/.test(new URL(url).hostname)) links.add(url);
    }
  }
  return [...links];
}

async function fetchJobs(config: SearchConfig, queries: string[]): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { jobs: [], warnings: ['X recent search needs X_BEARER_TOKEN in .env.local; no X posts were searched'] };
  const settings = config.sources.xposts;
  const terms = [...new Set(queries.map((term) => term.toLowerCase()
    .replace(/front[ -]?end/g, 'frontend').replace(/\b(?:developer|engineer)\b/g, '').trim()))]
    .filter((term) => term.length > 2).slice(0, settings.maxQueries);
  const searches = await Promise.allSettled(terms.map(async (term) => {
    const url = new URL(settings.searchEndpoint);
    url.searchParams.set('query', `${term} (hiring OR job) remote has:links -is:retweet lang:en`);
    url.searchParams.set('tweet.fields', 'entities,created_at');
    url.searchParams.set('max_results', String(settings.postsPerQuery));
    const data = await getJson(url.toString(), { Authorization: `Bearer ${token}` }) as { data?: XPost[] };
    return data.data ?? [];
  }));
  const failures = searches.filter((result) => result.status === 'rejected');
  if (failures.length === searches.length) throw new Error(`All X searches failed: ${String((failures[0] as PromiseRejectedResult).reason)}`);
  const posts = searches.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const pages = jobLinksFromXPosts(posts).slice(0, settings.maxLinkedPages);
  const jobs: SourceJob[] = [];
  let failedPages = 0;
  for (let index = 0; index < pages.length; index += 4) {
    const batch = await Promise.allSettled(pages.slice(index, index + 4).map(async (page) => extractJobPostingsFromHtml(await htmlFrom(page), page)));
    for (const result of batch) {
      if (result.status === 'rejected') { failedPages++; continue; }
      for (const posting of result.value) jobs.push({
        id: posting.pageUrl, source: 'X', sourceUrl: posting.pageUrl, applyUrl: posting.pageUrl,
        title: posting.title, company: posting.company, location: posting.location,
        employment: posting.employment, descriptionHtml: posting.descriptionHtml,
        publishedAt: posting.publishedAt, expiryAt: posting.expiryAt,
        seniority: [], timezoneRestrictions: [],
      });
    }
  }
  return { jobs, warnings: [
    `${posts.length} posts; ${pages.length} linked pages inspected; ${jobs.length} structured remote postings`,
    ...(failures.length ? [`${failures.length} searches failed`] : []),
    ...(failedPages ? [`${failedPages} linked pages failed`] : []),
  ] };
}

export const xposts: SourceAdapter = { id: 'xposts', fetch: fetchJobs };
