import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveQueries } from '../lib/config.ts';

const config = JSON.parse(readFileSync(new URL('../config/search.json', import.meta.url), 'utf8'));
const profile = { resumeText: 'Frontend Developer | React, Next.js, TypeScript. Built JavaScript interfaces.' };

test('frontend interest expands using skills actually in the CV', () => {
  const queries = effectiveQueries(config, { searchTerms: ['frontend'] }, profile);
  assert.ok(queries.includes('frontend'));
  assert.ok(queries.includes('react developer'));
  assert.ok(queries.includes('next.js developer'));
  assert.ok(queries.includes('javascript developer'));
  assert.ok(!queries.includes('software engineer'));
});

test('CV suggests frontend focus when no desired role is saved', () => {
  const queries = effectiveQueries(config, { searchTerms: [] }, profile);
  assert.ok(queries.includes('frontend'));
  assert.ok(!queries.includes('software engineer'));
});
