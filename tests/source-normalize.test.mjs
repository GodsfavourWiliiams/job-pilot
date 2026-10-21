import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHimalayas, normaliseJobicy, normaliseRemoteOk, normaliseRemotive } from '../lib/normalise-source.ts';

test('Himalayas country objects and Unix dates retain their meaning', () => {
  const row = normaliseHimalayas({
    guid: 'https://himalayas.app/companies/example/jobs/react-developer',
    applicationLink: 'https://himalayas.app/apply/123',
    title: 'React Developer', companyName: 'Example',
    locationRestrictions: [{ alpha2: 'NG', name: 'Nigeria', slug: 'nigeria' }],
    timezoneRestrictions: ['UTC+1'], seniority: ['Mid-level'],
    employmentType: 'Full Time', pubDate: 1_782_000_000,
  });
  assert.equal(row.location, 'Nigeria');
  assert.equal(row.applyUrl, 'https://himalayas.app/apply/123');
  assert.match(row.publishedAt, /^2026-/);
  assert.deepEqual(row.timezoneRestrictions, ['UTC+1']);
  assert.equal(normaliseHimalayas({ pubDate: 1_782_000_000_000 }).publishedAt, row.publishedAt);
});

test('Remotive unknown location remains explicit', () => {
  const row = normaliseRemotive({ id: 1, url: 'https://remotive.com/test', title: 'Developer', company_name: 'Example' });
  assert.equal(row.location, 'Unknown');
  assert.equal(row.employment, '');
});

test('Jobicy keeps employment, location, and seniority restrictions', () => {
  const row = normaliseJobicy({ id: 7, url: 'https://jobicy.com/jobs/7', jobTitle: 'React Developer', companyName: 'Example', jobGeo: 'Anywhere', jobType: ['Full-Time'], jobLevel: 'Mid', jobDescription: '<p>React work</p>' });
  assert.equal(row.location, 'Anywhere');
  assert.equal(row.employment, 'Full-Time');
  assert.deepEqual(row.seniority, ['Mid']);
});

test('Remote OK unknown geography is not assumed worldwide', () => {
  const row = normaliseRemoteOk({ id: 8, url: 'https://remoteok.com/remote-jobs/8', position: 'Frontend Developer', company: 'Example', location: '', tags: ['full time'] });
  assert.equal(row.location, 'Unknown');
  assert.equal(row.employment, 'full time');
});
