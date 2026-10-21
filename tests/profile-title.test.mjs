import test from 'node:test';
import assert from 'node:assert/strict';
import { inferProfessionalTitle } from '../lib/profile-title.ts';

test('new CV headline is suggested from its own header', () => {
  assert.equal(inferProfessionalTitle('Example Candidate\nFrontend Developer | React, Next.js\nLagos, Nigeria\nSUMMARY\nFrontend work.'), 'Frontend Developer');
  assert.equal(inferProfessionalTitle('Example Candidate\nLagos, Nigeria\nSUMMARY\nExperienced software engineer on web teams.'), '');
});
