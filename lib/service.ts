import { createDraft } from './draft';
import { loadSearchConfig } from './config';
import { discoverJobs } from './feeds';
import { sendGmail, gmailConfigured, removeTokens } from './gmail';
import { dedupeKey, eligibleLocation, eligibleTimezone, findApplicationEmail, jobId, normaliseEmployment, plainText, scoreJob } from './match';
import { makeResumePdf } from './resume-pdf';
import { inferProfessionalTitle } from './profile-title';
import { readStore, updateStore } from './store';
import type { Job, JobStatus, Preferences, Profile, Store } from './types';

async function refreshOpenApplications(state: Store, refreshDrafts = true): Promise<void> {
  const config = await loadSearchConfig();
  for (const job of state.jobs) {
    if (!['pending', 'ready', 'failed'].includes(job.status)) continue;
    const match = scoreJob(job, state.profile, state.preferences, config);
    job.score = match.score;
    job.matchReasons = match.reasons;
    job.level = match.level;
    job.locationVerified = eligibleLocation(job.location, state.profile.country, config.location);
    if (refreshDrafts) {
      if (state.profile.name && state.profile.resumeText) job.draft = createDraft(state.profile, job);
      else delete job.draft;
      job.status = job.applicationEmail ? 'ready' : 'pending';
      delete job.lastError;
    }
  }
}

export async function replaceResume(text: string, fileName: string): Promise<void> {
  await updateStore(async (state) => {
    state.profile.resumeText = text.slice(0, 60_000);
    state.profile.resumeFileName = fileName.slice(0, 200);
    state.profile.professionalTitle = inferProfessionalTitle(text);
    await refreshOpenApplications(state);
  });
}

export async function saveProfile(input: Partial<Profile>): Promise<void> {
  await updateStore(async (state) => {
    const fields: (keyof Profile)[] = ['name', 'professionalTitle', 'email', 'phone', 'location', 'country', 'timezone', 'linkedin', 'github', 'resumeText'];
    let contentChanged = false;
    for (const field of fields) {
      if (typeof input[field] === 'string') {
        const next = input[field]!.trim().slice(0, field === 'resumeText' ? 60_000 : 300);
        if (state.profile[field] !== next && ['name', 'professionalTitle', 'email', 'phone', 'location', 'country', 'timezone', 'linkedin', 'github', 'resumeText'].includes(field)) contentChanged = true;
        state.profile[field] = next;
      }
    }
    if (contentChanged) await refreshOpenApplications(state);
  });
}

export async function savePreferences(input: Partial<Preferences>): Promise<void> {
  const config = await loadSearchConfig();
  await updateStore(async (state) => {
    const oldCriteria = JSON.stringify([state.preferences.searchTerms, state.preferences.employment, state.preferences.acceptedLevels]);
    if (Array.isArray(input.searchTerms)) state.preferences.searchTerms = input.searchTerms.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 10);
    if (Array.isArray(input.employment)) state.preferences.employment = input.employment.filter((x) => ['Full time', 'Part time', 'Contract'].includes(x));
    if (Array.isArray(input.acceptedLevels)) state.preferences.acceptedLevels = input.acceptedLevels.filter((x) => ['intern', 'entry', 'junior', 'mid', 'senior', 'unspecified'].includes(x));
    if (Array.isArray(input.disabledSources)) state.preferences.disabledSources = input.disabledSources.filter((x): x is string => typeof x === 'string' && x in config.sources);
    if ([10, 20, 30, 60].includes(Number(input.scanIntervalMinutes))) state.preferences.scanIntervalMinutes = Number(input.scanIntervalMinutes) as Preferences['scanIntervalMinutes'];
    for (const field of ['reviewBeforeEmail', 'autoScan', 'browserNotifications'] as const) {
      if (typeof input[field] === 'boolean') state.preferences[field] = input[field];
    }
    if (typeof input.maxEmailsPerDay === 'number') state.preferences.maxEmailsPerDay = Math.max(0, Math.min(20, Math.floor(input.maxEmailsPerDay)));
    if (typeof input.minScore === 'number') state.preferences.minScore = Math.max(0, Math.min(100, Math.floor(input.minScore)));
    if (oldCriteria !== JSON.stringify([state.preferences.searchTerms, state.preferences.employment, state.preferences.acceptedLevels])) await refreshOpenApplications(state, false);
  });
}

let scanInFlight: Promise<{ added: number; errors: string[]; attempted: number; skipped: number }> | null = null;

export function performScan(): Promise<{ added: number; errors: string[]; attempted: number; skipped: number }> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    const startedAt = new Date().toISOString();
    await updateStore((state) => { state.scanStartedAt = startedAt; });
    try { return await scanOnce(); }
    catch (error) {
      await updateStore((state) => {
        if (Date.parse(state.lastScanAt) >= Date.parse(startedAt)) return;
        state.lastScanAt = new Date().toISOString();
        state.lastScanSummary = `Scan failed: ${String(error)}`;
        state.scanLogs.unshift({ startedAt, finishedAt: '', summary: state.lastScanSummary, sources: [] });
        state.scanLogs = state.scanLogs.slice(0, 50);
      });
      throw error;
    } finally {
      await updateStore((state) => {
        state.scanFinishedAt = new Date().toISOString();
        const log = state.scanLogs.find((entry) => entry.startedAt === startedAt);
        if (log) log.finishedAt = state.scanFinishedAt;
      });
    }
  })().finally(() => { scanInFlight = null; });
  return scanInFlight;
}

async function scanOnce(): Promise<{ added: number; errors: string[]; attempted: number; skipped: number }> {
  const start = await readStore();
  if (!start.profile.name || !start.profile.resumeText) throw new Error('Add your name and CV before scanning');
  const config = await loadSearchConfig();
  const { jobs, errors, sourceCount, skippedSources, sourceRuns } = await discoverJobs(start.profile, start.preferences, config, start.sourceRuns);
  const fetchedCount = Object.values(sourceRuns).reduce((total, run) => total + run.jobCount, 0);
  const matchedCount = Object.values(sourceRuns).reduce((total, run) => total + run.matchedCount, 0);
  const allFailed = sourceCount > 0 && errors.length === sourceCount;
  const newIds = await updateStore((state) => {
    for (const existing of state.jobs) {
      if (!['pending', 'ready', 'failed'].includes(existing.status)) continue;
      const match = scoreJob(existing, state.profile, state.preferences, config);
      existing.score = match.score;
      existing.matchReasons = match.reasons;
      existing.level = match.level;
      existing.locationVerified = eligibleLocation(existing.location, state.profile.country, config.location);
    }
    for (const [id, run] of Object.entries(sourceRuns)) {
      state.sourceRuns[id] = { ...run, lastSuccessAt: run.lastSuccessAt || state.sourceRuns[id]?.lastSuccessAt || '' };
    }
    if (allFailed) {
      state.lastScanSummary = `All ${sourceCount} sources failed: ${errors.join('; ')}`;
      state.lastScanAt = new Date().toISOString();
      state.scanLogs.unshift({ startedAt: state.scanStartedAt, finishedAt: '', summary: state.lastScanSummary,
        sources: Object.entries(sourceRuns).map(([id, run]) => ({ id, fetched: run.jobCount, matched: run.matchedCount, error: run.error })) });
      state.scanLogs = state.scanLogs.slice(0, 50);
      return [];
    }
    const knownIds = new Set(state.jobs.map((job) => job.id));
    const knownKeys = new Set(state.jobs.map((job) => dedupeKey(job.title, job.company)));
    const added: string[] = [];
    for (const job of jobs) {
      const key = dedupeKey(job.title, job.company);
      if (knownIds.has(job.id) || knownKeys.has(key)) continue;
      job.draft = createDraft(state.profile, job);
      job.status = job.applicationEmail ? 'ready' : 'pending';
      state.jobs.push(job);
      knownIds.add(job.id); knownKeys.add(key); added.push(job.id);
    }
    state.jobs.sort((a, b) => b.score - a.score);
    state.lastScanAt = new Date().toISOString();
    state.lastScanSummary = `${fetchedCount} fetched; ${matchedCount} matched; ${added.length} new in queue; ${sourceCount} source(s) checked; ${skippedSources} on cooldown${errors.length ? `; ${errors.length} source error(s)` : ''}`;
    state.scanLogs.unshift({ startedAt: state.scanStartedAt, finishedAt: '', summary: state.lastScanSummary,
      sources: Object.entries(sourceRuns).map(([id, run]) => ({ id, fetched: run.jobCount, matched: run.matchedCount, error: run.error })) });
    state.scanLogs = state.scanLogs.slice(0, 50);
    return added;
  });
  if (allFailed) throw new Error(errors.join('; '));
  const after = await readStore();
  if (!after.preferences.reviewBeforeEmail && after.gmail.connected && gmailConfigured()) {
    for (const id of newIds) {
      const job = after.jobs.find((item) => item.id === id);
      if (job?.applicationEmail && job.locationVerified && job.level !== 'unspecified' && job.employment !== 'Unknown' && eligibleTimezone(job.timezoneRestrictions ?? [], after.profile.country, config.location)) {
        try { await sendApplication(id); } catch { /* visible on job card */ }
      }
    }
  }
  return { added: newIds.length, errors, attempted: sourceCount, skipped: skippedSources };
}

export async function addManualJob(input: Record<string, unknown>): Promise<Job> {
  const config = await loadSearchConfig();
  const title = String(input.title ?? '').trim().slice(0, 200);
  const company = String(input.company ?? '').trim().slice(0, 200);
  const description = plainText(String(input.description ?? '')).slice(0, 16_000);
  const applyUrl = String(input.applyUrl ?? '').trim().slice(0, 1000);
  const location = String(input.location ?? 'Worldwide').trim().slice(0, 200);
  if (!title || !company || !description || !applyUrl) throw new Error('Title, company, description, and application link are required');
  if (!/^https?:\/\/|^mailto:/i.test(applyUrl)) throw new Error('Use an http(s) link or mailto address');
  const employment = normaliseEmployment(String(input.employment ?? 'Full time'));
  if (!employment) throw new Error('Choose full time, part time, or contract');
  return updateStore((state) => {
    const match = scoreJob({ title, description, location, employment }, state.profile, state.preferences, config);
    const id = jobId('Manual', applyUrl);
    if (state.jobs.some((job) => job.id === id)) throw new Error('This application is already in your queue');
    const applicationEmail = findApplicationEmail(applyUrl, String(input.description ?? ''));
    const job: Job = {
      id, source: 'Manual', sourceUrl: applyUrl, applyUrl,
      title, company, location, employment, description,
      publishedAt: '', applicationEmail, score: match.score, level: match.level,
      matchReasons: match.reasons, status: applicationEmail ? 'ready' : 'pending',
      addedAt: new Date().toISOString(),
    };
    if (state.profile.resumeText && state.profile.name) job.draft = createDraft(state.profile, job);
    state.jobs.unshift(job);
    return job;
  });
}

export async function prepareJob(id: string): Promise<void> {
  await updateStore((state) => {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Job not found');
    if (!state.profile.name || !state.profile.resumeText) throw new Error('Add your name and CV first');
    job.draft = createDraft(state.profile, job);
    job.status = job.applicationEmail ? 'ready' : 'pending';
  });
}

export async function saveDraft(id: string, subject: string, body: string): Promise<void> {
  await updateStore((state) => {
    const job = state.jobs.find((item) => item.id === id);
    if (!job?.draft) throw new Error('Prepare this application first');
    if (job.status === 'sent' || job.status === 'sending') throw new Error('This application has already been sent');
    job.draft.subject = subject.trim().slice(0, 250);
    job.draft.body = body.trim().slice(0, 10_000);
    if (!job.draft.subject || !job.draft.body) throw new Error('Subject and message are required');
  });
}

export async function changeStatus(id: string, status: JobStatus, reason?: string, note?: string): Promise<void> {
  if (!['applied', 'dismissed', 'pending', 'ready'].includes(status)) throw new Error('Invalid status');
  if (status === 'dismissed' && !['not_remote', 'location', 'closed', 'wrong_role', 'duplicate', 'other'].includes(reason ?? '')) throw new Error('Choose why this job is not a fit');
  await updateStore((state) => {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Job not found');
    if (job.status === 'sent' || job.status === 'sending') throw new Error('Sent applications cannot be changed');
    job.status = status;
    if (status === 'dismissed') {
      job.dismissReason = reason as Job['dismissReason'];
      job.dismissNote = (note ?? '').trim().slice(0, 500);
      job.dismissedAt = new Date().toISOString();
    } else { delete job.dismissReason; delete job.dismissNote; delete job.dismissedAt; }
  });
}

export async function sendApplication(id: string): Promise<string> {
  if (!gmailConfigured()) throw new Error('Configure Gmail OAuth first');
  const reservation = await updateStore((state) => {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Job not found');
    if (!job.applicationEmail) throw new Error('This job requires a form; open the application link');
    if (job.status !== 'ready' && job.status !== 'failed') throw new Error('This application is not ready to send');
    if (!job.draft || !state.profile.name || !state.profile.resumeText) throw new Error('Prepare the application and CV first');
    if (!state.gmail.connected) throw new Error('Connect Gmail first');
    if (!state.profile.email || state.profile.email.toLowerCase() !== state.gmail.accountEmail.toLowerCase()) throw new Error('Profile email must match the connected Gmail account');
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = state.jobs.filter((item) => item.sentAt?.startsWith(today)).length;
    if (sentToday >= state.preferences.maxEmailsPerDay) throw new Error('Daily email limit reached');
    job.status = 'sending';
    job.lastError = undefined;
    return { job: structuredClone(job), profile: structuredClone(state.profile) };
  });
  try {
    const pdf = await makeResumePdf(reservation.profile, reservation.job);
    const messageId = await sendGmail(
      reservation.job.applicationEmail, reservation.job.draft!.subject,
      reservation.job.draft!.body, `${reservation.profile.name.replace(/\s+/g, '_')}_CV.pdf`, pdf,
    );
    await updateStore((state) => {
      const job = state.jobs.find((item) => item.id === id)!;
      job.status = 'sent'; job.sentAt = new Date().toISOString(); job.gmailMessageId = messageId;
    });
    return messageId;
  } catch (error) {
    await updateStore((state) => {
      const job = state.jobs.find((item) => item.id === id)!;
      job.status = 'failed'; job.lastError = String(error);
    });
    throw error;
  }
}

export async function resumeForJob(id: string): Promise<Uint8Array> {
  const state: Store = await readStore();
  const job = state.jobs.find((item) => item.id === id);
  if (!job) throw new Error('Job not found');
  if (!state.profile.resumeText) throw new Error('Upload or paste a CV first');
  return makeResumePdf(state.profile, job);
}

export async function disconnectGmail(): Promise<void> {
  await removeTokens();
  await updateStore((state) => { state.gmail = { connected: false, accountEmail: '' }; });
}
