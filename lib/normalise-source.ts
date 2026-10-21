import type { Job } from './types';

export interface SourceJob {
  id: string;
  source: Job['source'];
  sourceUrl: string;
  applyUrl: string;
  title: string;
  company: string;
  location: string;
  employment: string;
  descriptionHtml: string;
  publishedAt: string;
  seniority: string[];
  timezoneRestrictions: string[];
  expiryAt: string;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function dateValue(value: unknown): string {
  if (typeof value === 'number') {
    const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  return typeof value === 'string' ? value : '';
}

export function normaliseHimalayas(item: Record<string, unknown>): SourceJob {
  const restrictions = Array.isArray(item.locationRestrictions) ? item.locationRestrictions : [];
  const location = restrictions.length ? restrictions.map((place) => {
    if (typeof place === 'string') return place;
    if (place && typeof place === 'object') {
      const record = place as Record<string, unknown>;
      return String(record.name ?? record.alpha2 ?? record.slug ?? '');
    }
    return '';
  }).filter(Boolean).join(', ') : 'Worldwide';
  return {
    id: String(item.guid ?? ''), source: 'Himalayas',
    sourceUrl: String(item.guid ?? ''), applyUrl: String(item.applicationLink ?? ''),
    title: String(item.title ?? ''), company: String(item.companyName ?? ''),
    location, employment: String(item.employmentType ?? ''),
    descriptionHtml: String(item.description ?? item.excerpt ?? ''),
    publishedAt: dateValue(item.pubDate), expiryAt: dateValue(item.expiryDate),
    seniority: asStrings(item.seniority), timezoneRestrictions: asStrings(item.timezoneRestrictions),
  };
}

export function normaliseRemotive(item: Record<string, unknown>): SourceJob {
  return {
    id: String(item.id ?? item.url ?? ''), source: 'Remotive',
    sourceUrl: String(item.url ?? ''), applyUrl: String(item.url ?? ''),
    title: String(item.title ?? ''), company: String(item.company_name ?? ''),
    location: String(item.candidate_required_location ?? 'Unknown'),
    employment: String(item.job_type ?? ''),
    descriptionHtml: String(item.description ?? ''),
    publishedAt: String(item.publication_date ?? ''),
    seniority: [], timezoneRestrictions: [], expiryAt: '',
  };
}

export function normaliseJobicy(item: Record<string, unknown>): SourceJob {
  return {
    id: String(item.id ?? ''), source: 'Jobicy',
    sourceUrl: String(item.url ?? ''), applyUrl: String(item.url ?? ''),
    title: String(item.jobTitle ?? ''), company: String(item.companyName ?? ''),
    location: String(item.jobGeo ?? 'Unknown'),
    employment: asStrings(item.jobType).join(', '),
    descriptionHtml: String(item.jobDescription ?? item.jobExcerpt ?? ''),
    publishedAt: dateValue(item.pubDate),
    seniority: item.jobLevel && item.jobLevel !== 'Any' ? [String(item.jobLevel)] : [],
    timezoneRestrictions: [], expiryAt: '',
  };
}

export function normaliseRemoteOk(item: Record<string, unknown>): SourceJob {
  const tags = asStrings(item.tags);
  return {
    id: String(item.id ?? ''), source: 'Remote OK',
    sourceUrl: String(item.url ?? ''), applyUrl: String(item.apply_url ?? item.url ?? ''),
    title: String(item.position ?? ''), company: String(item.company ?? ''),
    location: String(item.location || 'Unknown'),
    employment: tags.filter((tag) => /full.?time|part.?time|contract|freelance/i.test(tag)).join(', '),
    descriptionHtml: String(item.description ?? ''),
    publishedAt: dateValue(item.date ?? item.epoch),
    seniority: tags.filter((tag) => /^(senior|junior|mid|manager|director)$/i.test(tag)),
    timezoneRestrictions: [], expiryAt: '',
  };
}

export function normaliseGreenhouse(item: Record<string, unknown>, board: { token: string; company: string }): SourceJob {
  const location = item.location && typeof item.location === 'object'
    ? String((item.location as Record<string, unknown>).name ?? '') : '';
  const content = String(item.content ?? '');
  const url = String(item.absolute_url ?? '');
  return {
    id: `${board.token}:${String(item.id ?? '')}`, source: 'Greenhouse',
    sourceUrl: url, applyUrl: url,
    title: String(item.title ?? ''), company: board.company,
    location, employment: String(item.employment_type ?? content.match(/\b(?:full[ -]?time|part[ -]?time|contract(?:or)?)\b/i)?.[0] ?? ''),
    descriptionHtml: content, publishedAt: '', seniority: [], timezoneRestrictions: [], expiryAt: '',
  };
}
