import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import { extractJobPostingsFromHtml } from '../scrape-jsonld.ts';
import { htmlFrom, publicPage } from './google.ts';
import { getJson } from './http.ts';
import type { SourceAdapter } from './types';

type Post = { record?: { text?: string; facets?: { features?: { uri?: string }[] }[] }; embed?: { external?: { uri?: string } } };

export function jobLinksFromPosts(posts: Post[]): string[] {
  const links = new Set<string>();
  for (const post of posts) {
    if (!/\b(?:hiring|apply|opening|vacanc(?:y|ies)|job)\b/i.test(post.record?.text ?? '')) continue;
    const urls = [post.embed?.external?.uri, ...(post.record?.facets ?? []).flatMap((facet) => (facet.features ?? []).map((feature) => feature.uri))];
    for (const candidate of urls) {
      const url = candidate ? publicPage(candidate) : null;
      if (url && !/(?:^|\.)(?:bsky\.app|x\.com|twitter\.com|linkedin\.com)$/.test(new URL(url).hostname)) links.add(url);
    }
  }
  return [...links];
}

async function fetchJobs(config: SearchConfig, queries: string[]): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const settings = config.sources.bluesky;
  const terms = [...new Set(queries.map((term) => term.toLowerCase()
    .replace(/front[ -]?end/g, 'frontend').replace(/\b(?:developer|engineer)\b/g, '').trim()))]
    .filter((term) => term.length > 2).slice(0, settings.maxQueries);
  const searches = await Promise.allSettled(terms.map(async (term) => {
    const url = new URL(settings.searchEndpoint);
    url.searchParams.set('q', `${term} remote hiring`);
    url.searchParams.set('sort', 'latest');
    url.searchParams.set('limit', String(settings.postsPerQuery));
    const data = await getJson(url.toString()) as { posts?: Post[] };
    if (!Array.isArray(data.posts)) throw new Error('Unexpected post search response');
    return data.posts;
  }));
  const failures = searches.filter((result) => result.status === 'rejected');
  if (failures.length === searches.length) throw new Error(`All Bluesky searches failed: ${String((failures[0] as PromiseRejectedResult).reason)}`);
  const posts = searches.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const pages = jobLinksFromPosts(posts).slice(0, settings.maxLinkedPages);
  const jobs: SourceJob[] = [];
  let failedPages = 0;
  for (let index = 0; index < pages.length; index += 4) {
    const batch = await Promise.allSettled(pages.slice(index, index + 4).map(async (page) => extractJobPostingsFromHtml(await htmlFrom(page), page)));
    for (const result of batch) {
      if (result.status === 'rejected') { failedPages++; continue; }
      for (const posting of result.value) jobs.push({
        id: posting.pageUrl, source: 'Bluesky', sourceUrl: posting.pageUrl, applyUrl: posting.pageUrl,
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

export const bluesky: SourceAdapter = { id: 'bluesky', fetch: fetchJobs };
