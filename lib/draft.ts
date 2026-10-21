import type { Draft, Job, Profile } from './types';

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9+.]{2,}/g) ?? []);
}

function factsFromResume(resumeText: string): string[] {
  const lines = resumeText.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const facts: string[] = [];
  let current = '';
  for (const line of lines) {
    if (/^[•●▪*-]\s+/.test(line)) {
      if (current) facts.push(current);
      current = line.replace(/^[•●▪*-]\s+/, '');
    } else if (current && !/^[A-Z][A-Z\s&/]+$/.test(line) && !/\|/.test(line)) {
      current += ` ${line}`;
    } else if (current) {
      facts.push(current);
      current = '';
    }
  }
  if (current) facts.push(current);
  if (facts.length) return facts.filter((fact) => fact.length > 35).slice(0, 60);
  return lines.filter((line) => line.length > 45 && line.length < 350).slice(0, 60);
}

export function relevantSkills(profile: Profile, job: Pick<Job, 'title' | 'description'>): string[] {
  const context = `${job.title} ${job.description}`.toLowerCase();
  const lines = profile.resumeText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*(skills|technical skills|core skills)\s*$/i.test(line));
  const skillLines: string[] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (/^\s*(experience|work experience|education|projects|selected project)\s*$/i.test(line)) break;
      skillLines.push(line);
    }
  }
  const items = skillLines.join(',').replace(/\([^)]*\)/g, '').split(',')
    .map((item) => item.replace(/^[^:]{1,35}:\s*/, '').trim())
    .filter((item) => item.length >= 2 && item.length < 45);
  return [...new Set(items)].filter((skill) => context.includes(skill.toLowerCase())).slice(0, 6);
}

export function selectHighlights(profile: Profile, job: Pick<Job, 'title' | 'description'>): string[] {
  const target = words(`${job.title} ${job.description}`);
  const ranked = factsFromResume(profile.resumeText).map((fact, index) => {
    const overlap = [...words(fact)].filter((word) => target.has(word)).length;
    return { fact, score: overlap, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, 3).map(({ fact }) => fact);
}

export function createDraft(profile: Profile, job: Job): Draft {
  const highlights = selectHighlights(profile, job);
  const skills = relevantSkills(profile, job);
  const location = profile.location || profile.country || 'Nigeria';
  const intro = skills.length
    ? `My experience with ${skills.join(', ')} matches several parts of the role.`
    : `My ${profile.professionalTitle || 'software development'} experience matches the role’s focus.`;
  const proof = highlights.length
    ? `Relevant work from my CV includes:\n${highlights.map((h) => `• ${h}`).join('\n')}`
    : 'I would welcome the chance to discuss how my experience fits your team.';
  return {
    subject: `Application for ${job.title} — ${profile.name}`,
    body: `Hello ${job.company} hiring team,\n\nI’m applying for the ${job.title} role. ${intro}\n\n${proof}\n\nI’m based in ${location} and available to work remotely. I’ve attached my CV and would be glad to discuss the position.\n\nBest,\n${profile.name}${profile.phone ? `\n${profile.phone}` : ''}${profile.linkedin ? `\n${profile.linkedin}` : ''}`,
    highlights,
    createdAt: new Date().toISOString(),
  };
}
