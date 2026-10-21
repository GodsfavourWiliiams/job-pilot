import type { SearchConfig } from '../config';
import type { SourceJob } from '../normalise-source.ts';
import type { SourceAdapter } from './types';

function decodeXml(value: string): string {
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, dec: string) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)));
}

function field(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

export function parseWwrFeed(xml: string): SourceJob[] {
  const jobs: SourceJob[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const titleWithCompany = field(item, 'title');
    const separator = titleWithCompany.indexOf(': ');
    const sourceUrl = field(item, 'link') || field(item, 'guid');
    if (separator < 1 || !/^https:\/\/weworkremotely\.com\//i.test(sourceUrl)) continue;
    jobs.push({ id: field(item, 'guid') || sourceUrl, source: 'We Work Remotely', sourceUrl, applyUrl: sourceUrl,
      title: titleWithCompany.slice(separator + 2).trim(), company: titleWithCompany.slice(0, separator).trim(),
      location: field(item, 'region') || field(item, 'country') || 'Unknown', employment: field(item, 'type'),
      descriptionHtml: field(item, 'description'), publishedAt: field(item, 'pubDate'), expiryAt: field(item, 'expires_at'),
      seniority: [], timezoneRestrictions: [] });
  }
  return jobs;
}

async function fetchJobs(config: SearchConfig): Promise<{ jobs: SourceJob[]; warnings: string[] }> {
  const feeds = config.sources.weworkremotely.feeds;
  const results = await Promise.allSettled(feeds.map(async (url) => {
    const response = await fetch(url, { headers: { accept: 'application/rss+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (xml.length > 5_000_000 || !/<rss\b/i.test(xml)) throw new Error('Unexpected RSS feed');
    return parseWwrFeed(xml);
  }));
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed.length === feeds.length) throw new Error(`All RSS feeds failed: ${failed.map((x) => String(x.reason)).join('; ')}`);
  const jobs = [...new Map(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((job) => [job.id, job])).values()];
  return { jobs, warnings: results.flatMap((result, index) => result.status === 'rejected' ? [`Feed ${index + 1}: ${String(result.reason)}`] : []) };
}

export const weworkremotely: SourceAdapter = { id: 'weworkremotely', fetch: fetchJobs };
