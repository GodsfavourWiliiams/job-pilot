import { createHash } from 'node:crypto';
import type { SearchConfig } from './config';
import { effectiveQueries } from './config.ts';
import type { CareerLevel, Employment, Job, Preferences, Profile } from './types';

export function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

export function normaliseEmployment(value: string): Employment | null {
  const v = value.toLowerCase();
  if (/part.?time/.test(v)) return 'Part time';
  if (/contract|freelance|temporary/.test(v)) return 'Contract';
  if (/full.?time/.test(v)) return 'Full time';
  return null;
}

export function eligibleLocation(location: string, country: string, config: SearchConfig['location']): boolean {
  const value = location.toLowerCase().trim();
  if (!value) return false;
  const accepted = config.countryAliases[country.trim().toLowerCase()] ?? [country];
  const excluded = value.match(/\b(?:except|excluding|not available in|not hiring in)\s+([^.;]+)/i)?.[1] ?? '';
  if (excluded && accepted.some((term) => term && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(excluded))) return false;
  if (value === 'anywhere' || value === 'remote anywhere') return true;
  if (!/\b(?:except|excluding|excluding applicants from)\b/.test(value) && config.worldwideTerms.some((term) => value.includes(term.toLowerCase()))) return true;
  return accepted.some((term) => {
    if (!term) return false;
    if (term.toLowerCase() === 'africa') return /(?:^|[,;\/()\-]\s*)africa\b/i.test(value);
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value);
  });
}

export function eligibleTimezone(offsets: string[], country: string, config: SearchConfig['location']): boolean {
  if (!offsets.length) return true;
  const candidate = config.utcOffsetMinutesByCountry[country.trim().toLowerCase()];
  if (candidate === undefined) return false;
  return offsets.some((value) => {
    const match = value.trim().match(/^(?:UTC|GMT)?\s*([+-]?)(\d{1,2})(?::?(\d{2}))?$/i);
    if (!match) return false;
    const minutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === '-' ? -1 : 1);
    return minutes === candidate;
  });
}

const genericTitleWords = new Set(['engineer', 'developer', 'designer', 'specialist', 'associate', 'junior', 'mid', 'level', 'remote']);
const stopWords = new Set(['with', 'from', 'that', 'this', 'have', 'your', 'their', 'work', 'team', 'role', 'years', 'strong', 'experience', 'using', 'build', 'built', 'will', 'and', 'the', 'for', 'are', 'you', 'our', 'all', 'into', 'across', 'more', 'than', 'able', 'good', 'working', 'skills', 'development', 'engineer', 'developer', 'software']);

export function eligibleRole(title: string, searchTerms: string[]): boolean {
  if (/\breact[ -]?native\b/i.test(title) && !searchTerms.some((term) => /\breact[ -]?native\b/i.test(term))) return false;
  if (/\bbackend[ -]?focused\b/i.test(title) && !searchTerms.some((term) => /\bbackend\b/i.test(term))) return false;
  const normalise = (value: string) => value.toLowerCase().replace(/front[\s-]?end/g, 'frontend').replace(/full[\s-]?stack/g, 'fullstack').replace(/next[.\s-]?js/g, 'nextjs').replace(/[^a-z0-9]+/g, ' ').trim();
  const titleText = normalise(title);
  return searchTerms.some((term) => {
    const wanted = normalise(term);
    if (wanted && titleText.includes(wanted)) return true;
    const distinctive = wanted.split(' ').filter((word) => word.length > 2 && !genericTitleWords.has(word));
    return distinctive.some((word) => titleText.split(' ').includes(word));
  });
}

export function classifyCareerLevel(title: string, seniority: string[], config: SearchConfig['roles']): CareerLevel {
  const words = new Set(`${title} ${seniority.join(' ')}`.toLowerCase().match(/[a-z]+/g) ?? []);
  // A senior signal wins when a board supplies conflicting labels.
  for (const level of ['senior', 'mid', 'junior', 'entry', 'intern'] as const) {
    if (config.levelTerms[level].some((term) => words.has(term.toLowerCase()))) return level;
  }
  return 'unspecified';
}

export function effectiveCareerLevels(profile: Profile, prefs: Preferences): CareerLevel[] {
  if (prefs.acceptedLevels.length) return prefs.acceptedLevels;
  const lines = profile.resumeText.split('\n').map((line) => line.trim()).filter(Boolean);
  const currentRole = lines.find((line) => /\b(?:engineer|developer|designer|specialist)\b/i.test(line) && /\b(?:20\d{2}|present|current)\b/i.test(line)) ?? '';
  const heading = `${profile.professionalTitle}\n${currentRole || lines.slice(0, 3).join('\n')}`;
  if (/\b(?:senior|staff|principal|lead)\b/i.test(heading)) return ['mid', 'senior', 'unspecified'];
  if (/\b(?:mid|intermediate)\b/i.test(heading)) return ['mid', 'senior', 'unspecified'];
  if (/\b(?:junior|entry|graduate)\b/i.test(heading)) return ['entry', 'junior', 'mid', 'unspecified'];
  return ['junior', 'mid', 'senior', 'unspecified'];
}

export function findApplicationEmail(applyUrl: string, htmlDescription: string): string {
  if (applyUrl.toLowerCase().startsWith('mailto:')) {
    const raw = applyUrl.slice(7).split('?')[0];
    return decodeURIComponent(raw).trim();
  }
  const text = plainText(htmlDescription);
  const explicit = text.match(/(?:apply|send (?:your|a) (?:cv|resume|application)|email (?:your|us))[^.\n]{0,120}?\b([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  return explicit?.[1] ?? '';
}

function tokenise(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? []);
}

export function scoreJob(job: Pick<Job, 'title' | 'description' | 'location' | 'employment'> & Partial<Pick<Job, 'seniority' | 'timezoneRestrictions'>>, profile: Profile, prefs: Preferences, config: SearchConfig): { score: number; reasons: string[]; level: CareerLevel } {
  const queries = effectiveQueries(config, prefs, profile);
  const level = classifyCareerLevel(job.title, job.seniority ?? [], config.roles);
  if (!eligibleRole(job.title, queries)) return { score: 0, reasons: ['Outside chosen role specialty'], level };
  if (!effectiveCareerLevels(profile, prefs).includes(level)) return { score: 0, reasons: [`${level} level is outside your preferences`], level };
  const titleCountry = job.title.match(/\b(?:US|USA|United States|Canada|India|Colombia|Mexico|Brazil|Dominican Republic|LatAm|UK)\b(?=\s*(?:\||\/|-|remote\b))/i)?.[0]
    ?? job.title.match(/(?:\||\/|-)\s*(US|USA|United States|Canada|India|Colombia|Mexico|Brazil|Dominican Republic|LatAm|UK)\s*(?:\||\/|-)\s*remote\b/i)?.[1];
  if (titleCountry && !/\b(?:Nigeria|NG|Africa|EMEA|Worldwide|Global)\b/i.test(titleCountry)) return { score: 0, reasons: [`Title restricts location to ${titleCountry}`], level };
  const locationEligible = eligibleLocation(job.location, profile.country, config.location);
  const locationUnverified = !locationEligible && /^(?:unknown|remote|work from home|flexible\s*\/\s*remote)(?:\s*\((?:unspecified|location unknown)\))?$/i.test(job.location.trim());
  if (!locationEligible && !locationUnverified) return { score: 0, reasons: [`Location restriction does not include ${profile.country || 'your country'}`], level };
  if (job.employment !== 'Unknown' && !prefs.employment.includes(job.employment)) return { score: 0, reasons: ['Employment type excluded'], level };
  const title = job.title.toLowerCase();
  const desc = tokenise(job.description);
  const cv = tokenise(profile.resumeText);
  const matches = [...desc].filter((term) => term.length > 3 && !stopWords.has(term) && cv.has(term)).slice(0, 20);
  let score = 35;
  if (queries.some((term) => title.includes(term.toLowerCase()))) score += 25;
  else score += 10;
  if (/\b(mid|intermediate|junior|entry)\b/.test(title)) score += 8;
  score += Math.min(matches.length * 3, 30);
  const reasons = [locationUnverified ? 'Remote location eligibility not stated; verify before applying' : 'Remote role eligible for your location', job.employment === 'Unknown' ? 'Employment type not stated; verify before applying' : `${job.employment} position`];
  if (level === 'unspecified') reasons.push('Career level not stated; verify before applying');
  else reasons.push(`${level[0].toUpperCase()}${level.slice(1)} level`);
  if (job.timezoneRestrictions?.length) reasons.push(`Source lists timezone restrictions: ${job.timezoneRestrictions.join(', ')}; verify overlap before applying`);
  if (matches.length) reasons.push(`CV matches: ${matches.slice(0, 5).join(', ')}`);
  return { score: Math.max(0, Math.min(score, 100)), reasons, level };
}

export function jobId(source: string, unique: string): string {
  return createHash('sha256').update(`${source}:${unique}`).digest('hex').slice(0, 16);
}

export function dedupeKey(title: string, company: string): string {
  return `${title} ${company}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}
