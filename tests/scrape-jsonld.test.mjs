import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJobPostingsFromHtml } from '../lib/scrape-jsonld.ts';

test('HTML scraper extracts a remote JobPosting and keeps unknown eligibility explicit', () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Frontend Developer',
    hiringOrganization: { '@type': 'Organization', name: 'Example' },
    jobLocationType: 'TELECOMMUTE', employmentType: 'FULL_TIME',
    description: '<p>Build React interfaces</p>', url: '/careers/frontend',
  })}</script></html>`;
  assert.deepEqual(extractJobPostingsFromHtml(html, 'https://example.com/careers'), [{
    title: 'Frontend Developer', company: 'Example', pageUrl: 'https://example.com/careers/frontend',
    descriptionHtml: '<p>Build React interfaces</p>', location: 'Unknown',
    employment: 'FULL_TIME', publishedAt: '', expiryAt: '',
  }]);
});

test('HTML scraper ignores malformed or on-site postings', () => {
  const html = '<script type="application/ld+json">{oops}</script><script type="application/ld+json">{"@type":"JobPosting","title":"Developer","hiringOrganization":{"name":"Example"},"jobLocationType":"ON_SITE"}</script>';
  assert.deepEqual(extractJobPostingsFromHtml(html, 'https://example.com/jobs'), []);
});
