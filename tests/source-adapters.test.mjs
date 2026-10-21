import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enabledAdapters } from '../lib/sources/index.ts';
import { remotive } from '../lib/sources/remotive.ts';
import { greenhouse } from '../lib/sources/greenhouse.ts';
import { jobicy } from '../lib/sources/jobicy.ts';
import { google, googleResultLinks } from '../lib/sources/google.ts';
import { arbeitnow } from '../lib/sources/arbeitnow.ts';
import { parseWwrFeed, weworkremotely } from '../lib/sources/weworkremotely.ts';
import { themuse } from '../lib/sources/themuse.ts';
import { remotejobs } from '../lib/sources/remotejobs.ts';
import { linkedin, linkedinJobLinks } from '../lib/sources/linkedin.ts';
import { bluesky, jobLinksFromPosts } from '../lib/sources/bluesky.ts';
import { xposts, jobLinksFromXPosts } from '../lib/sources/x-posts.ts';

const config = JSON.parse(readFileSync(new URL('../config/search.json', import.meta.url), 'utf8'));

test('source registry respects server configuration', () => {
  const selected = structuredClone(config);
  selected.sources.jobicy.enabled = false;
  assert.deepEqual(enabledAdapters(selected).map((source) => source.id), ['himalayas', 'remotive', 'remoteok', 'greenhouse', 'google', 'arbeitnow', 'weworkremotely', 'themuse', 'remotejobs', 'linkedin', 'bluesky', 'xposts']);
});

test('source registry respects user switches and per-source cooldowns', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const runs = { remotive: { lastRunAt: '2026-10-21T11:00:00Z' }, greenhouse: { lastRunAt: '2026-10-21T10:00:00Z' } };
  assert.deepEqual(enabledAdapters(config, ['jobicy'], runs, now).map((source) => source.id), ['himalayas', 'remoteok', 'greenhouse', 'google', 'arbeitnow', 'weworkremotely', 'themuse', 'remotejobs', 'linkedin', 'bluesky', 'xposts']);
});

test('failed sources are eligible for an earlier retry', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const runs = { google: { lastRunAt: '2026-10-21T11:45:00Z', error: 'HTTP 302' } };
  assert.ok(enabledAdapters(config, [], runs, now).some((source) => source.id === 'google'));
});

test('access-blocked sources back off while other sources can still run', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const runs = { google: { lastRunAt: '2026-10-21T11:00:00Z', error: 'Google challenge or consent redirect' },
    themuse: { lastRunAt: '2026-10-21T11:00:00Z', error: 'HTTP 403' } };
  const enabled = enabledAdapters(config, [], runs, now).map((source) => source.id);
  assert.ok(!enabled.includes('google'));
  assert.ok(!enabled.includes('themuse'));
  assert.ok(enabled.includes('remotejobs'));
});

test('Google result parser keeps job links and rejects navigation, redirects to private addresses', () => {
  const html = '<a href="/url?q=https%3A%2F%2Fjobs.example.com%2Fremote-react&amp;sa=U"><h3>Remote React Developer</h3></a><a href="https://www.google.com/about"><h3>About</h3></a><a href="/url?q=https%3A%2F%2F127.0.0.1%2Fadmin"><h3>Bad</h3></a>';
  assert.deepEqual(googleResultLinks(html), ['https://jobs.example.com/remote-react']);
});

test('Google connector searches, inspects pages and extracts remote structured jobs', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.google.maxQueries = 1;
  selected.sources.google.maxPages = 2;
  globalThis.fetch = async (url) => {
    const search = String(url).startsWith('https://www.google.com/search');
    const html = search
      ? '<a href="https://jobs.example.com/roles/react"><h3>React Developer</h3></a>'
      : '<script type="application/ld+json">{"@type":"JobPosting","title":"React Developer","hiringOrganization":{"name":"Example"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"name":"Worldwide"},"description":"Build React interfaces"}</script>';
    return { ok: true, headers: { get: () => 'text/html' }, text: async () => html };
  };
  try {
    const result = await google.fetch(selected, ['react developer']);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, 'Google');
    assert.match(result.warnings[0], /1 result pages inspected/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Google connector follows a search redirect before reading results', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.google.maxQueries = 1;
  globalThis.fetch = async (url) => String(url).includes('www.google.com/search')
    ? { ok: false, status: 302, headers: { get: (name) => name === 'location' ? 'https://www.google.com/preferences?hl=en' : null } }
    : { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<html><body>No results</body></html>' };
  try {
    const result = await google.fetch(selected, ['frontend']);
    assert.equal(result.jobs.length, 0);
    assert.match(result.warnings.join(' '), /no extractable result links/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Arbeitnow connector reads only remote jobs from configured pages', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.arbeitnow.maxPages = 1;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { slug: 'react', remote: true, title: 'React Developer', company_name: 'Example', url: 'https://www.arbeitnow.com/view/react', location: 'Worldwide', job_types: ['full_time'], description: 'React role', created_at: 1700000000 },
    { slug: 'office', remote: false, title: 'Frontend Developer', company_name: 'Example', url: 'https://www.arbeitnow.com/view/office' },
  ] }) });
  try {
    const jobs = await arbeitnow.fetch(selected, []);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].source, 'Arbeitnow');
    assert.equal(jobs[0].employment, 'full_time');
  } finally { globalThis.fetch = originalFetch; }
});

test('We Work Remotely RSS parser preserves company, region, and HTML description', () => {
  const xml = '<rss><channel><item><title><![CDATA[Example: Frontend Developer]]></title><link>https://weworkremotely.com/remote-jobs/example-frontend</link><region>Anywhere in the World</region><type>Full-Time</type><description><![CDATA[<p>React &amp; Next.js</p>]]></description><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
  const jobs = parseWwrFeed(xml);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Example');
  assert.equal(jobs[0].location, 'Anywhere in the World');
  assert.match(jobs[0].descriptionHtml, /React & Next.js/);
});

test('We Work Remotely connector deduplicates overlapping category feeds', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.weworkremotely.feeds = selected.sources.weworkremotely.feeds.slice(0, 2);
  globalThis.fetch = async () => ({ ok: true, text: async () => '<rss><item><title>Example: Frontend Developer</title><link>https://weworkremotely.com/remote-jobs/example-frontend</link><region>Anywhere in the World</region></item></rss>' });
  try {
    const result = await weworkremotely.fetch(selected, []);
    assert.equal(result.jobs.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('The Muse connector requests remote pages and keeps remote listings', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.themuse.maxPages = 1;
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = String(url);
    return { ok: true, json: async () => ({ page_count: 1, results: [
      { id: 1, name: 'React Developer', company: { name: 'Example' }, refs: { landing_page: 'https://www.themuse.com/jobs/example/react-developer' }, locations: [{ name: 'Flexible / Remote' }], levels: [{ name: 'Mid Level' }], contents: '<p>React interfaces</p>' },
      { id: 2, name: 'Office Developer', company: { name: 'Example' }, refs: { landing_page: 'https://www.themuse.com/jobs/example/office' }, locations: [{ name: 'New York, NY' }] },
    ] }) };
  };
  try {
    const result = await themuse.fetch(selected, []);
    assert.equal(new URL(requested).searchParams.get('location'), 'Flexible / Remote');
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, 'The Muse');
    assert.deepEqual(result.jobs[0].seniority, ['Mid Level']);
  } finally { globalThis.fetch = originalFetch; }
});

test('RemoteJobs.org searches CV-derived specialties with pagination and deduplication', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.remotejobs.maxQueries = 2;
  selected.sources.remotejobs.pagesPerQuery = 2;
  selected.sources.remotejobs.pageSize = 1;
  const requested = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed);
    return { ok: true, json: async () => ({ data: [{ id: 'job-1', title: 'Frontend Engineer', company: { name: 'Example' }, url: 'https://remotejobs.org/remote-jobs/example', location: 'Remote', location_normalization: { scope: 'worldwide' }, type: 'Full-time', description: '<p>React role</p>' }], pagination: { has_more: parsed.searchParams.get('offset') === '0' } }) };
  };
  try {
    const result = await remotejobs.fetch(selected, ['frontend', 'front end', 'react developer', 'next.js developer']);
    assert.deepEqual(requested.map((url) => url.searchParams.get('q')), ['frontend', 'frontend', 'react', 'react']);
    assert.deepEqual(requested.map((url) => url.searchParams.get('offset')), ['0', '1', '0', '1']);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].location, 'Worldwide');
  } finally { globalThis.fetch = originalFetch; }
});

test('RemoteJobs.org preserves country limits for eligibility checks', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.remotejobs.maxQueries = 1;
  selected.sources.remotejobs.pagesPerQuery = 1;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { id: 'us-only', title: 'Frontend Developer', company: { name: 'Example' }, url: 'https://remotejobs.org/remote-jobs/us-only', location: 'Remote', location_normalization: { allowed_countries: ['US'] } },
    { id: 'not-ng', title: 'React Developer', company: { name: 'Example' }, url: 'https://remotejobs.org/remote-jobs/not-ng', location: 'Remote', location_normalization: { scope: 'worldwide', excluded_countries: ['NG'] } },
  ], pagination: { has_more: false } }) });
  try {
    const result = await remotejobs.fetch(selected, ['frontend']);
    assert.deepEqual(result.jobs.map((job) => job.location), ['United States', 'Worldwide except Nigeria']);
  } finally { globalThis.fetch = originalFetch; }
});

test('LinkedIn public search follows job cards and keeps structured remote postings', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.linkedin.locations = ['Nigeria'];
  selected.sources.linkedin.maxQueries = 1;
  const page = '<a href="https://www.linkedin.com/jobs/view/frontend-engineer-123?trackingId=abc">Frontend</a><a href="/jobs/view/frontend-engineer-123?foo=bar">duplicate</a><a href="https://other.example/jobs/view/456">other</a>';
  assert.deepEqual(linkedinJobLinks(page), ['https://www.linkedin.com/jobs/view/frontend-engineer-123']);
  globalThis.fetch = async (url) => ({ ok: true, headers: { get: () => 'text/html' }, text: async () =>
    String(url).includes('/jobs/search/') ? page
      : '<script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Engineer","hiringOrganization":{"name":"Example"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"name":"Nigeria"},"employmentType":"FULL_TIME","description":"Build React interfaces"}</script>' });
  try {
    const result = await linkedin.fetch(selected, ['frontend engineer']);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, 'LinkedIn');
    assert.equal(result.jobs[0].location, 'Nigeria');
    assert.match(result.warnings[0], /1 structured remote postings/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Bluesky follows application links from hiring posts and verifies job metadata', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.bluesky.maxQueries = 1;
  const post = { record: { text: 'We are hiring a remote React engineer', facets: [{ features: [{ uri: 'https://jobs.example.com/roles/react' }] }] } };
  assert.deepEqual(jobLinksFromPosts([post, { record: { text: 'Read this article', facets: [{ features: [{ uri: 'https://jobs.example.com/roles/nope' }] }] } }]), ['https://jobs.example.com/roles/react']);
  globalThis.fetch = async (url) => String(url).includes('public.api.bsky.app')
    ? { ok: true, json: async () => ({ posts: [post] }) }
    : { ok: true, headers: { get: () => 'text/html' }, text: async () => '<script type="application/ld+json">{"@type":"JobPosting","title":"React Engineer","hiringOrganization":{"name":"Example"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"name":"Worldwide"},"description":"Build React interfaces"}</script>' };
  try {
    const result = await bluesky.fetch(selected, ['react developer']);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, 'Bluesky');
    assert.match(result.warnings[0], /1 posts; 1 linked pages inspected/);
  } finally { globalThis.fetch = originalFetch; }
});

test('X source reports missing credentials and extracts linked job pages with a token', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.X_BEARER_TOKEN;
  delete process.env.X_BEARER_TOKEN;
  const noToken = await xposts.fetch(config, ['react developer']);
  assert.match(noToken.warnings[0], /X_BEARER_TOKEN/);
  const selected = structuredClone(config);
  selected.sources.xposts.maxQueries = 1;
  const post = { text: 'Hiring remote React engineer', entities: { urls: [{ expanded_url: 'https://jobs.example.com/roles/react' }] } };
  assert.deepEqual(jobLinksFromXPosts([post, { text: 'Article', entities: { urls: [{ expanded_url: 'https://jobs.example.com/other' }] } }]), ['https://jobs.example.com/roles/react']);
  process.env.X_BEARER_TOKEN = 'fixture-token';
  globalThis.fetch = async (url) => String(url).includes('api.x.com')
    ? { ok: true, json: async () => ({ data: [post] }) }
    : { ok: true, headers: { get: () => 'text/html' }, text: async () => '<script type="application/ld+json">{"@type":"JobPosting","title":"React Engineer","hiringOrganization":{"name":"Example"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"name":"Worldwide"},"description":"Build React interfaces"}</script>' };
  try {
    const result = await xposts.fetch(selected, ['react developer']);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, 'X');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalToken;
  }
});

test('Greenhouse adapter reads catalog boards and keeps only explicitly remote jobs', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.greenhouse.boards = [{ token: 'example', company: 'Example Co' }];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ jobs: [
    { id: 1, title: 'Frontend Engineer', absolute_url: 'https://job-boards.greenhouse.io/example/jobs/1', location: { name: 'Home based - Africa, Lagos' }, content: '<p>Full-time React role</p>' },
    { id: 2, title: 'Frontend Engineer', absolute_url: 'https://job-boards.greenhouse.io/example/jobs/2', location: { name: 'Lagos, Nigeria' }, content: '<p>Full-time office role</p>' },
  ] }) });
  try {
    const result = await greenhouse.fetch(selected, []);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].company, 'Example Co');
    assert.equal(result.jobs[0].employment, 'Full-time');
    assert.match(result.jobs[0].location, /Africa/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Greenhouse adapter reports a failed company board without discarding other boards', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.greenhouse.boards = [{ token: 'good', company: 'Good Co' }, { token: 'bad', company: 'Bad Co' }];
  globalThis.fetch = async (url) => String(url).includes('/bad/')
    ? { ok: false, status: 503 }
    : { ok: true, json: async () => ({ jobs: [] }) };
  try {
    const result = await greenhouse.fetch(selected, []);
    assert.deepEqual(result.jobs, []);
    assert.match(result.warnings[0], /Bad Co/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Remotive adapter requests its configured feed and normalizes listings', async () => {
  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = String(url);
    return { ok: true, json: async () => ({ jobs: [{ id: 7, title: 'Frontend Developer', company_name: 'Example', url: 'https://example.com/job', candidate_required_location: 'Worldwide', job_type: 'full_time', description: '<p>React role</p>' }] }) };
  };
  try {
    const jobs = await remotive.fetch(config, []);
    assert.equal(new URL(requested).searchParams.get('category'), config.sources.remotive.category);
    assert.equal(jobs[0].source, 'Remotive');
    assert.equal(jobs[0].title, 'Frontend Developer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Jobicy adapter follows a cursor and stops at the configured page limit', async () => {
  const originalFetch = globalThis.fetch;
  const selected = structuredClone(config);
  selected.sources.jobicy.maxPages = 2;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(new URL(url));
    const id = requested.length;
    return { ok: true, json: async () => ({ success: true, nextCursor: `cursor-${id}`, jobs: [{ id, jobTitle: 'React Developer', companyName: 'Example', url: `https://jobicy.com/jobs/${id}`, jobGeo: 'Anywhere', jobType: ['Full-Time'] }] }) };
  };
  try {
    const jobs = await jobicy.fetch(selected, []);
    assert.equal(jobs.length, 2);
    assert.equal(requested[1].searchParams.get('cursor'), 'cursor-1');
    assert.equal(requested[0].pathname, '/api/jobs');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
