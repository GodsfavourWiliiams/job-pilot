import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCareerLevel, effectiveCareerLevels, eligibleLocation, eligibleRole, eligibleTimezone, findApplicationEmail, normaliseEmployment, scoreJob } from '../lib/match.ts';
import { createDraft } from '../lib/draft.ts';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../config/search.json', import.meta.url), 'utf8'));

const profile = {
  name: 'Example Candidate', email: 'candidate@example.com', phone: '',
  location: 'Uyo, Nigeria', country: 'Nigeria', linkedin: '', github: '', resumeFileName: '',
  resumeText: 'Frontend Engineer\nSKILLS\nReact, TypeScript, Next.js, REST APIs\nEXPERIENCE\n• Built a React dashboard with live API integration, improving reporting time by 30%.\n• Optimized Next.js rendering and fixed production performance issues.',
};
const preferences = {
  searchTerms: [], acceptedLevels: ['entry', 'junior', 'mid', 'unspecified'], employment: ['Full time', 'Part time', 'Contract'],
  reviewBeforeEmail: true, autoScan: true, maxEmailsPerDay: 5, minScore: 35, browserNotifications: true,
};

test('excludes senior titles and locations that do not include Nigeria', () => {
  assert.equal(eligibleRole('Mid-Level React Developer', config.roles.queries), true);
  assert.equal(eligibleRole('Next.js Developer', config.roles.queries), true);
  assert.equal(eligibleRole('Sr REACT NATIVE', config.roles.queries), false);
  assert.equal(classifyCareerLevel('Senior Frontend Engineer', [], config.roles), 'senior');
  assert.equal(scoreJob({ title: 'Senior Frontend Engineer', location: 'Worldwide', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config).score, 0);
  assert.equal(scoreJob({ title: 'Frontend Engineer', seniority: ['Senior'], location: 'Worldwide', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config).score, 0);
  assert.equal(eligibleLocation('United States only', 'Nigeria', config.location), false);
  assert.equal(eligibleLocation('Anywhere in the US', 'Nigeria', config.location), false);
  assert.equal(eligibleLocation('Anywhere', 'Nigeria', config.location), true);
  assert.ok(scoreJob({ title: 'React Developer', location: 'Anywhere', employment: 'Full time', description: 'Build React interfaces' }, profile, preferences, config).score >= preferences.minScore);
  assert.equal(eligibleLocation('Work from anywhere in the US', 'Nigeria', config.location), false);
  assert.equal(eligibleLocation('Worldwide except Nigeria', 'Nigeria', config.location), false);
  assert.equal(eligibleLocation('South Africa', 'Nigeria', config.location), false);
  assert.equal(eligibleLocation('Anywhere in the world', 'Nigeria', config.location), true);
  assert.equal(eligibleLocation('EMEA', 'Nigeria', config.location), true);
  assert.equal(eligibleLocation('Home based - Africa, Lagos', 'Nigeria', config.location), true);
  assert.equal(scoreJob({ title: 'Frontend Engineer', location: 'US only', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config).score, 0);
  assert.equal(scoreJob({ title: 'Frontend Engineer', location: 'Remote, US', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config).score, 0);
  assert.equal(scoreJob({ title: 'Frontend Engineer | US | Remote', location: 'Remote', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config).score, 0);
  assert.equal(scoreJob({ title: 'Senior Full-stack Engineer (React/Node) (Backend-Focused) - Colombia/Remote', location: 'Remote', employment: 'Full time', description: 'React TypeScript' }, profile, { ...preferences, acceptedLevels: ['senior'] }, config).score, 0);
  const unknownRegion = scoreJob({ title: 'Frontend Engineer', location: 'Unknown', employment: 'Full time', description: 'React TypeScript' }, profile, preferences, config);
  assert.ok(unknownRegion.score > 0);
  assert.ok(unknownRegion.reasons.some((reason) => reason.includes('verify before applying')));
  assert.ok(scoreJob({ title: 'Frontend Engineer', location: 'Flexible / Remote', employment: 'Unknown', description: 'React TypeScript' }, profile, preferences, config).score > 0);
});

test('checks timezone and employment restrictions explicitly', () => {
  assert.equal(eligibleTimezone(['UTC+1'], 'Nigeria', config.location), true);
  assert.equal(eligibleTimezone(['UTC-5'], 'Nigeria', config.location), false);
  assert.equal(normaliseEmployment('Contractor'), 'Contract');
  assert.equal(normaliseEmployment('Intern'), null);
});

test('career levels default to the current CV role and keep unlabelled jobs eligible', () => {
  const inferred = { ...preferences, acceptedLevels: [] };
  const seniorProfile = { ...profile, professionalTitle: 'Frontend Developer', resumeText: 'Frontend Developer\nEXPERIENCE\nSenior Frontend Engineer | Example Jan 2024 to Present' };
  assert.deepEqual(effectiveCareerLevels(seniorProfile, inferred), ['mid', 'senior', 'unspecified']);
  assert.ok(scoreJob({ title: 'Frontend Engineer', location: 'Worldwide', employment: 'Full time', description: 'React role with no years specified' }, seniorProfile, inferred, config).score > 0);
  const incomplete = scoreJob({ title: 'Frontend Engineer', location: 'Worldwide', employment: 'Unknown', timezoneRestrictions: ['UTC-5'], description: 'React role' }, seniorProfile, inferred, config);
  assert.ok(incomplete.score > 0);
  assert.ok(incomplete.reasons.some((reason) => reason.includes('Employment type not stated')));
  assert.ok(incomplete.reasons.some((reason) => reason.includes('timezone restrictions')));
  assert.equal(scoreJob({ title: 'Frontend Intern', location: 'Worldwide', employment: 'Full time', description: 'React internship' }, seniorProfile, inferred, config).score, 0);
});

test('only identifies an application email when the listing explicitly asks for one', () => {
  assert.equal(findApplicationEmail('mailto:jobs@example.com', ''), 'jobs@example.com');
  assert.equal(findApplicationEmail('https://example.com/apply', 'Contact support@example.com with questions.'), '');
  assert.equal(findApplicationEmail('https://example.com/apply', 'To apply, send your CV to jobs@example.com.'), 'jobs@example.com');
});

test('draft cites actual CV work and role details', () => {
  const job = { title: 'Frontend Engineer', company: 'Acme', description: 'Build React dashboards with TypeScript', location: 'Worldwide', employment: 'Full time', id: '1', source: 'Manual', sourceUrl: '', applyUrl: '', publishedAt: '', applicationEmail: 'jobs@example.com', score: 80, matchReasons: [], status: 'ready', addedAt: '' };
  const draft = createDraft(profile, job);
  assert.match(draft.subject, /Frontend Engineer/);
  assert.match(draft.body, /Acme/);
  assert.match(draft.body, /Built a React dashboard/);
  assert.ok(draft.highlights.every((fact) => profile.resumeText.includes(fact)));
});
