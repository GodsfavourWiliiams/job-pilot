/** Extracts structured job data from HTML returned by a permitted career page. */
export interface ScrapedPosting {
  title: string;
  company: string;
  pageUrl: string;
  descriptionHtml: string;
  location: string;
  employment: string;
  publishedAt: string;
  expiryAt: string;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...objects(record['@graph'])];
}

function placeName(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(placeName);
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string') return [record.name];
  return placeName(record.addressCountry ?? record.addressRegion ?? record.address);
}

export function extractJobPostingsFromHtml(html: string, pageUrl: string): ScrapedPosting[] {
  const postings: ScrapedPosting[] = [];
  const scripts = html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    for (const item of objects(parsed)) {
      const type = item['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!types.some((value) => typeof value === 'string' && value.toLowerCase() === 'jobposting')) continue;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const organization = item.hiringOrganization;
      const company = organization && typeof organization === 'object'
        ? String((organization as Record<string, unknown>).name ?? '').trim() : '';
      const remote = placeName(item.jobLocationType).some((value) => /telecommute|remote/i.test(value));
      if (!title || !company || !remote) continue;
      const locations = placeName(item.applicantLocationRequirements);
      const jobUrl = typeof item.url === 'string' ? item.url : pageUrl;
      let canonical: string;
      try { canonical = new URL(jobUrl, pageUrl).toString(); } catch { continue; }
      postings.push({
        title, company, pageUrl: canonical,
        descriptionHtml: typeof item.description === 'string' ? item.description : '',
        location: locations.length ? locations.join(', ') : 'Unknown',
        employment: Array.isArray(item.employmentType) ? item.employmentType.join(', ') : String(item.employmentType ?? ''),
        publishedAt: String(item.datePosted ?? ''), expiryAt: String(item.validThrough ?? ''),
      });
    }
  }
  return postings;
}
