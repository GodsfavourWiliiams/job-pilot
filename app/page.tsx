'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CareerLevel, DismissReason, Employment, Job, Preferences, Profile, Store } from '@/lib/types';

type View = 'inbox' | 'history' | 'profile' | 'preferences' | 'sources';
type ActionResponse = { ok: boolean; error?: string; result?: unknown; state?: Store };
type StateResponse = Store & { gmailConfigured: boolean; searchConfig: { sources: { id: string; name: string; url: string; boards?: { company: string; url: string }[] }[]; effectiveQueries: string[]; effectiveLevels: CareerLevel[]; sourceCooldownMinutes: Record<string, number> } };

const employmentOptions: Employment[] = ['Full time', 'Part time', 'Contract'];
const timezoneOptions = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Lagos', 'UTC'];
const levelOptions: { value: CareerLevel; label: string }[] = [{ value: 'intern', label: 'Internship' }, { value: 'entry', label: 'Entry' }, { value: 'junior', label: 'Junior' }, { value: 'mid', label: 'Mid' }, { value: 'senior', label: 'Senior' }, { value: 'unspecified', label: 'Unspecified (review)' }];
const dismissOptions: { value: DismissReason; label: string }[] = [
  { value: 'wrong_role', label: 'Not the role I want' }, { value: 'not_remote', label: 'Not actually remote' },
  { value: 'location', label: 'Does not accept my location' }, { value: 'closed', label: 'Job closed or link broken' },
  { value: 'duplicate', label: 'Duplicate listing' }, { value: 'other', label: 'Other issue' },
];

function safeLink(value: string): string {
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : '#';
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(job: Job): string {
  if (job.status === 'pending') return 'Form to complete';
  if (job.status === 'ready') return 'Email ready';
  if (job.status === 'sending') return 'Sending';
  if (job.status === 'failed') return 'Send failed';
  if (job.status === 'sent') return 'Email sent';
  if (job.status === 'applied') return 'Applied';
  return 'Dismissed';
}

export default function Home() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [view, setView] = useState<View>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [dismissReason, setDismissReason] = useState<DismissReason>('wrong_role');
  const [dismissNote, setDismissNote] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [now, setNow] = useState(0);
  const [manual, setManual] = useState({ title: '', company: '', location: 'Worldwide', employment: 'Full time', applyUrl: '', description: '' });

  const refresh = useCallback(async () => {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load dashboard');
    const next = await response.json() as StateResponse;
    setState(next);
    setProfile(next.profile);
    setPreferences(next.preferences);
  }, []);

  useEffect(() => { refresh().catch((cause) => setError(String(cause))); }, [refresh]);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        const next = await response.json() as StateResponse;
        setState((previous) => {
          const oldCount = previous?.jobs.filter((job) => ['pending', 'ready'].includes(job.status)).length ?? 0;
          const newCount = next.jobs.filter((job) => ['pending', 'ready'].includes(job.status)).length;
          if (previous && newCount > oldCount && next.preferences.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('New remote applications', { body: `${newCount - oldCount} new match${newCount - oldCount === 1 ? '' : 'es'} in JobPilot` });
          }
          return next;
        });
      } catch { /* polling resumes on next interval */ }
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  const action = useCallback(async (name: string, data: Record<string, unknown> = {}, key = name) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const response = await fetch('/api/action', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-job-pilot': '1' },
        body: JSON.stringify({ action: name, ...data }),
      });
      const result = await response.json() as ActionResponse;
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'Request failed');
      if (result.state) setState((prev) => ({ ...prev!, ...result.state!, gmailConfigured: prev?.gmailConfigured ?? false }));
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return null; }
    finally { setBusy(''); }
  }, []);

  const pending = useMemo(() => state?.jobs.filter((job) => ['pending', 'ready', 'failed', 'sending'].includes(job.status) && job.score >= state.preferences.minScore) ?? [], [state]);
  const history = useMemo(() => state?.jobs.filter((job) => ['sent', 'applied', 'dismissed'].includes(job.status)) ?? [], [state]);
  const selected = state?.jobs.find((job) => job.id === selectedId) ?? null;
  const currentJobs = view === 'history' ? history : pending;
  const sourceOptions = [...new Set(currentJobs.map((job) => job.source))].sort();
  const shown = [...currentJobs].filter((job) => {
    const query = jobQuery.trim().toLowerCase();
    return (!query || `${job.title} ${job.company}`.toLowerCase().includes(query))
      && (statusFilter === 'all' || job.status === statusFilter)
      && (sourceFilter === 'all' || job.source === sourceFilter);
  }).sort((a, b) => sortBy === 'score' ? b.score - a.score
    : sortBy === 'oldest' ? Date.parse(a.addedAt) - Date.parse(b.addedAt)
      : sortBy === 'company' ? a.company.localeCompare(b.company)
        : Date.parse(b.addedAt) - Date.parse(a.addedAt));

  useEffect(() => { setStatusFilter('all'); setSourceFilter('all'); setJobQuery(''); }, [view]);

  useEffect(() => {
    setSubject(selected?.draft?.subject ?? '');
    setBody(selected?.draft?.body ?? '');
    setDismissReason('wrong_role'); setDismissNote('');
  }, [selectedId, selected?.draft?.createdAt]);

  async function scan() {
    const result = await action('scan');
    if (result) { const scanResult = result.result as { added: number; attempted: number; skipped: number }; setNotice(`${scanResult.added} new matches · ${scanResult.attempted} sources checked · ${scanResult.skipped} on cooldown.`); }
  }

  async function uploadResume(file: File) {
    setBusy('upload'); setError(''); setNotice('');
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/resume', { method: 'POST', headers: { 'x-job-pilot': '1' }, body: form });
      const result = await response.json() as ActionResponse;
      if (!response.ok || !result.ok || !result.state) throw new Error(result.error ?? 'Upload failed');
      setState((prev) => ({ ...prev!, ...result.state!, gmailConfigured: prev?.gmailConfigured ?? false }));
      setProfile(result.state.profile);
      setNotice('CV uploaded. Review the extracted text and professional title; open application drafts and match scores have been refreshed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  }

  async function saveProfileForm() {
    if (!profile) return;
    const result = await action('profile', { data: profile });
    if (result) { await refresh(); setNotice('Profile saved.'); }
  }

  async function savePreferencesForm() {
    if (!preferences) return;
    const result = await action('preferences', { data: preferences });
    if (result) { await refresh(); setNotice('Preferences saved.'); }
  }

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    const result = await action('addJob', { data: manual });
    if (result) {
      setShowAdd(false);
      setManual({ title: '', company: '', location: 'Worldwide', employment: 'Full time', applyUrl: '', description: '' });
      setNotice('Application added to your queue.');
    }
  }

  if (!state || !profile || !preferences) return <div className="loading"><span className="brand-mark">✦</span><p>Opening JobPilot…</p>{error && <p className="error">{error}</p>}</div>;

  const profileReady = Boolean(state.profile.name && state.profile.resumeText);
  const scanRunning = Boolean(state.scanStartedAt && Date.parse(state.scanStartedAt) > Date.parse(state.scanFinishedAt || '1970-01-01') && now - Date.parse(state.scanStartedAt) < 10 * 60_000);
  const nextScanAt = state.preferences.autoScan && profileReady
    ? new Date(Date.parse(state.lastScanAt || '1970-01-01') + state.preferences.scanIntervalMinutes * 60_000).toISOString() : '';
  const nextScanLabel = nextScanAt ? Date.parse(nextScanAt) <= now ? 'Due now' : formatDateTime(nextScanAt) : 'Paused';

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">✦</div><div><strong>JobPilot</strong><small>Remote work, within reach</small></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="nav">
        <button className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')}><span>▤</span> Application queue <b>{pending.length}</b></button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><span>◷</span> History <b>{history.length}</b></button>
        <button className={view === 'sources' ? 'active' : ''} onClick={() => setView('sources')}><span>◉</span> Source activity</button>
      </nav>
      <div className="sidebar-label settings-label">SETTINGS</div>
      <nav className="nav">
        <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><span>◯</span> Profile & CV</button>
        <button className={view === 'preferences' ? 'active' : ''} onClick={() => setView('preferences')}><span>⚙</span> Preferences</button>
      </nav>
      <div className="sidebar-bottom"><span className="signal" /> Local workspace<div>Private data stays on this computer</div></div>
    </aside>

    <main className="main">
      <header className="topbar"><span>JOB SEARCH / {view.toUpperCase()}</span><div className="topbar-right"><span className="today">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span><div className="avatar">{(state.profile.name || 'GW').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</div></div></header>
      <div className="content">
        {error && <div className="alert error"><span>!</span>{error}<button onClick={() => setError('')}>×</button></div>}
        {notice && <div className="alert success"><span>✓</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}

        {(view === 'inbox' || view === 'history') && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR OPPORTUNITY DESK</div><h1>{view === 'inbox' ? 'Application queue' : 'Application history'}</h1><p>{view === 'inbox' ? 'Remote roles matched to your CV, ready for your next move.' : 'A record of applications you sent or completed.'}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => setShowAdd(true)}>+ Add a job</button><button className="button primary" disabled={busy === 'scan' || !profileReady} onClick={scan}>{busy === 'scan' ? 'Searching…' : '↻  Find jobs'}</button></div></div>
          {!profileReady && <div className="setup-card"><div className="setup-icon">✦</div><div><strong>Finish your profile to start searching</strong><p>Add your name and upload your CV. JobPilot will use it to match roles and prepare truthful applications.</p></div><button className="button primary" onClick={() => setView('profile')}>Set up profile →</button></div>}
          <section className="scan-activity" aria-live="polite"><div className="scan-activity-title"><span className={`scan-light ${scanRunning ? 'running' : state.preferences.autoScan && profileReady ? 'active' : ''}`} /><div><strong>{scanRunning ? 'Searching job sources now' : state.preferences.autoScan && profileReady ? 'Automatic search is on' : 'Automatic search is paused'}</strong><small>{state.preferences.autoScan && profileReady ? `Checks every ${state.preferences.scanIntervalMinutes} minutes while this server is running` : profileReady ? 'Turn it on in Preferences to resume scheduled checks' : 'Complete your profile to start scheduled checks'}</small></div></div><div className="scan-activity-times"><div><span>Last run</span><strong>{formatDateTime(state.lastScanAt)}</strong></div><div><span>Next check</span><strong>{scanRunning ? 'After this run' : nextScanLabel}</strong></div></div>{state.lastScanSummary && <p>{state.lastScanSummary}</p>}</section>
          <div className="stats"><div className="stat"><span>NEEDS ATTENTION</span><strong>{pending.length}</strong><small>Applications in queue</small></div><div className="stat"><span>FORMS TO COMPLETE</span><strong>{pending.filter((j) => !j.applicationEmail).length}</strong><small>Open and submit manually</small></div><div className="stat"><span>EMAIL READY</span><strong>{pending.filter((j) => j.applicationEmail && j.status === 'ready').length}</strong><small>{preferences.reviewBeforeEmail ? 'Waiting for your review' : 'Will send when connected'}</small></div><div className="stat"><span>COMPLETED</span><strong>{history.filter((j) => ['sent', 'applied'].includes(j.status)).length}</strong><small>Applications tracked</small></div></div>
          <div className="section-head"><div><h2>{view === 'inbox' ? 'Matches for you' : 'Completed applications'}</h2><p>{view === 'inbox' ? 'No source selection needed. We search remote feeds for you.' : 'Your submission trail stays organized here.'}</p></div>{state.lastScanSummary && <div className="last-scan">{state.lastScanSummary}</div>}</div>
          <div className="job-filters"><label>Search<input type="search" value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} placeholder="Job title or company" /></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{(view === 'history' ? [['applied', 'Applied'], ['sent', 'Email sent'], ['dismissed', 'Not a fit']] : [['pending', 'Form to complete'], ['ready', 'Email ready'], ['failed', 'Send failed']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Source<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">All sources</option>{sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label>Sort<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="newest">Newest added</option><option value="oldest">Oldest added</option><option value="score">Highest match</option><option value="company">Company A–Z</option></select></label></div>
          {shown.length ? <div className="job-list">{shown.map((job) => <button key={job.id} className="job-card" onClick={() => setSelectedId(job.id)}><div className="company-icon">{job.company.slice(0, 1).toUpperCase()}</div><div className="job-main"><div className="job-title-row"><h3>{job.title}</h3><span className={`pill ${job.status}`}>{statusLabel(job)}</span></div><div className="company">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◌ {job.locationVerified === false ? 'Remote · location to verify' : 'Remote'}</span><span>◷ {job.employment}</span><span>↗ {job.source}</span>{job.publishedAt && <span>{formatDate(job.publishedAt)}</span>}</div></div><div className="match"><strong>{job.score}%</strong><span>match</span></div><span className="card-arrow">→</span></button>)}</div> : <div className="empty"><div className="empty-art">✧</div><h3>{currentJobs.length ? 'No jobs match these filters' : view === 'inbox' ? 'No matches in the queue yet' : 'No completed applications yet'}</h3><p>{currentJobs.length ? 'Try another search, status, or source.' : view === 'inbox' ? 'Automatic search runs while the local server is running. Check Source activity for fetched counts, filters, and failures.' : 'Submitted applications will appear here.'}</p>{view === 'inbox' && !currentJobs.length && <button className="button primary" disabled={!profileReady || busy === 'scan'} onClick={scan}>Check sources now</button>}</div>}
          <div className="source-note">Job data from {state.searchConfig.sources.map((source, index) => <span key={source.name}>{index > 0 ? ", " : ""}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)}. Open each listing to confirm it is still available before applying.</div>
        </>}

        {view === 'profile' && <><div className="page-heading"><div><div className="eyebrow">YOUR FOUNDATION</div><h1>Profile & CV</h1><p>Your details and original CV are used to prepare each application.</p></div><button className="button primary" disabled={busy === 'profile'} onClick={saveProfileForm}>Save profile</button></div><div className="form-layout"><div className="panel"><div className="panel-head"><h2>Personal details</h2><p>Editable for you or anyone who uses this app later.</p></div><div className="form-grid"><label>Full name<input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Your full name" /></label><label>Professional title<input value={profile.professionalTitle ?? ''} onChange={(e) => setProfile({ ...profile, professionalTitle: e.target.value })} placeholder="Frontend Developer" /></label><label>Email address<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="you@example.com" /></label><label>Phone<input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="+234…" /></label><label>Location<input value={profile.location} onChange={(e) => setProfile({ ...profile, location: e.target.value })} placeholder="City, country" /></label><label>Country of residence<input value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} /></label><label>Time zone<select value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}><option value="">Choose time zone</option>{profile.timezone && !timezoneOptions.includes(profile.timezone) && <option value={profile.timezone}>{profile.timezone}</option>}{timezoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label><label>LinkedIn<input value={profile.linkedin} onChange={(e) => setProfile({ ...profile, linkedin: e.target.value })} placeholder="linkedin.com/in/…" /></label><label className="wide">GitHub or portfolio<input value={profile.github} onChange={(e) => setProfile({ ...profile, github: e.target.value })} placeholder="github.com/…" /></label></div></div><div className="panel"><div className="panel-head"><h2>Curriculum vitae</h2><p>Upload a PDF. We extract its text so applications can cite your real work.</p></div><label className="upload-box"><span className="upload-symbol">⇧</span><strong>{busy === 'upload' ? 'Reading your CV…' : 'Upload a PDF CV'}</strong><small>{profile.resumeFileName || 'PDF up to 5 MB · or paste text below'}</small><input type="file" accept="application/pdf,.pdf" disabled={busy === 'upload'} onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadResume(file); }} /></label><label className="resume-label">CV text<textarea value={profile.resumeText} onChange={(e) => setProfile({ ...profile, resumeText: e.target.value })} rows={19} placeholder="Your CV text appears here after upload. You can also paste it manually." /></label><p className="help">Check the extracted text and professional title. Replacing the CV refreshes open drafts and match scores.</p></div></div></>}

        {view === 'preferences' && <><div className="page-heading"><div><div className="eyebrow">HOW JOBPILOT WORKS</div><h1>Preferences</h1><p>Set the rules for matching, review, and automatic email applications.</p></div><button className="button primary" disabled={busy === 'preferences'} onClick={savePreferencesForm}>Save preferences</button></div><div className="form-layout"><div className="panel"><div className="panel-head"><h2>Job criteria</h2><p>Remote only. Choose the career levels you want below.</p></div><label>Jobs you want<input value={preferences.searchTerms.join(', ')} placeholder="e.g. frontend, react developer" onChange={(e) => setPreferences({ ...preferences, searchTerms: e.target.value.split(',').map((x) => x.trim()) })} /><small>Separate role interests with commas. Leave blank to infer a focus from your CV. Frontend interests expand into matching React, Next.js, and JavaScript roles when your CV supports them. Current searches: {state.searchConfig.effectiveQueries.join(', ')}.</small></label><div className="field-title">Career levels</div><div className="checks"><label><input type="checkbox" checked={preferences.acceptedLevels.length === 0} onChange={(e) => setPreferences({ ...preferences, acceptedLevels: e.target.checked ? [] : state.searchConfig.effectiveLevels })} />Infer from CV</label>{levelOptions.map((option) => <label key={option.value}><input type="checkbox" checked={preferences.acceptedLevels.includes(option.value)} onChange={(e) => setPreferences({ ...preferences, acceptedLevels: e.target.checked ? [...preferences.acceptedLevels, option.value] : preferences.acceptedLevels.filter((x) => x !== option.value) })} />{option.label}</label>)}</div><p className="help">Effective levels: {state.searchConfig.effectiveLevels.join(', ')}. A job with no stated level stays in review and never auto-sends. Your choices are saved on the server.</p><div className="field-title">Employment types</div><div className="checks">{employmentOptions.map((type) => <label key={type}><input type="checkbox" checked={preferences.employment.includes(type)} onChange={(e) => setPreferences({ ...preferences, employment: e.target.checked ? [...preferences.employment, type] : preferences.employment.filter((x) => x !== type) })} />{type}</label>)}</div><label>Minimum match score <strong>{preferences.minScore}%</strong><input className="range" type="range" min="0" max="100" step="5" value={preferences.minScore} onChange={(e) => setPreferences({ ...preferences, minScore: Number(e.target.value) })} /></label></div><div className="panel"><div className="panel-head"><h2>Automation</h2><p>Choose when the app can send an email application.</p></div><div className="toggle-row"><div><strong>Review emails before sending</strong><p>When on, each email stays in your queue for approval. When off, new email applications may send automatically after a scan.</p></div><input type="checkbox" role="switch" checked={preferences.reviewBeforeEmail} onChange={(e) => setPreferences({ ...preferences, reviewBeforeEmail: e.target.checked })} /></div><div className="toggle-row"><div><strong>Automatic search</strong><p>Check on your chosen interval while the local app is running.</p></div><input type="checkbox" role="switch" checked={preferences.autoScan} onChange={(e) => setPreferences({ ...preferences, autoScan: e.target.checked })} /></div><div className="toggle-row"><div><strong>Browser notifications</strong><p>Show a notification for new matches while the dashboard is open.</p></div><input type="checkbox" role="switch" checked={preferences.browserNotifications} onChange={(e) => { setPreferences({ ...preferences, browserNotifications: e.target.checked }); if (e.target.checked && 'Notification' in window) Notification.requestPermission(); }} /></div><label>Search interval<select value={preferences.scanIntervalMinutes} onChange={(e) => setPreferences({ ...preferences, scanIntervalMinutes: Number(e.target.value) as Preferences['scanIntervalMinutes'] })}>{[10, 20, 30, 60].map((minutes) => <option value={minutes} key={minutes}>Every {minutes} minutes</option>)}</select><small>Each source has its own cooldown. Frequent checks will reuse the queue until a source is due.</small></label><label>Maximum emails per day<input type="number" min="0" max="20" value={preferences.maxEmailsPerDay} onChange={(e) => setPreferences({ ...preferences, maxEmailsPerDay: Number(e.target.value) })} /></label></div><div className="panel"><div className="panel-head"><h2>Email connection</h2><p>Gmail uses OAuth with send-only access. Your password is never stored here.</p></div><div className="connection"><div className={`connection-dot ${state.gmail.connected ? 'connected' : ''}`} /><div><strong>{state.gmail.connected ? 'Gmail connected' : 'Gmail not connected'}</strong><small>{state.gmail.connected ? state.gmail.accountEmail : state.gmailConfigured ? 'Ready to connect' : 'Add Google OAuth details to .env.local first'}</small></div></div>{state.gmailConfigured && <div className="connection-actions"><a className="button primary" href="/api/gmail/connect">{state.gmail.connected ? 'Reconnect Gmail' : 'Connect Gmail'}</a>{state.gmail.connected && <button className="button secondary" onClick={async () => { if (await action('disconnectGmail')) setNotice('Gmail disconnected from this app.'); }}>Disconnect</button>}</div>}<p className="help">Email applications need an explicit application address. Forms always stay in your queue for manual submission.</p></div></div></>}

        {view === 'sources' && <><div className="page-heading"><div><div className="eyebrow">AUTOMATION / OBSERVABILITY</div><h1>Source activity</h1><p>See which job sources ran, what they found, and why they failed or filtered listings.</p></div><button className="button primary" disabled={busy === 'preferences'} onClick={savePreferencesForm}>Save source switches</button></div><section className="scan-activity"><div className="scan-activity-title"><span className={`scan-light ${scanRunning ? 'running' : state.preferences.autoScan && profileReady ? 'active' : ''}`} /><div><strong>{scanRunning ? 'Search running now' : state.preferences.autoScan && profileReady ? 'Scheduled search active' : 'Scheduled search paused'}</strong><small>Last run {formatDateTime(state.lastScanAt)} · Next check {scanRunning ? 'after this run' : nextScanLabel.toLowerCase()}</small></div></div><div className="scan-activity-times"><div><span>Interval</span><strong>{state.preferences.scanIntervalMinutes} minutes</strong></div><div><span>Saved runs</span><strong>{state.scanLogs.length}</strong></div></div>{state.lastScanSummary && <p>{state.lastScanSummary}</p>}</section><div className="source-grid"><div className="panel"><div className="panel-head"><h2>Source status</h2><p>Each source reports its latest fetch before matching and filtering.</p></div><div className="source-status-list">{state.searchConfig.sources.map((source) => { const run = state.sourceRuns[source.id]; return <div className="source-status" key={source.id}><label className="source-enable"><input type="checkbox" checked={!preferences.disabledSources.includes(source.id)} onChange={(e) => setPreferences({ ...preferences, disabledSources: e.target.checked ? preferences.disabledSources.filter((id) => id !== source.id) : [...preferences.disabledSources, source.id] })} />Enabled</label><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a><small>{run ? `${run.jobCount} fetched · ${run.matchedCount === undefined ? 'match count pending' : `${run.matchedCount} matched`} · last tried ${formatDate(run.lastRunAt)}${run.lastSuccessAt ? ` · last worked ${formatDate(run.lastSuccessAt)}` : ''}` : 'Not scanned yet'}</small><small>Minimum fetch interval: {state.searchConfig.sourceCooldownMinutes[source.id]} minutes</small>{run?.filtered && Object.keys(run.filtered).length > 0 && <small>Filtered: {Object.entries(run.filtered).map(([reason, count]) => `${count} ${reason}`).join('; ')}</small>}{source.boards && <small>Boards: {source.boards.map((board, index) => <span key={board.company}>{index > 0 ? ", " : ""}<a href={board.url} target="_blank" rel="noreferrer">{board.company}</a></span>)}</small>}{run?.warning && <small className="source-warning">Details: {run.warning}</small>}{run?.error && <small className="inline-error">{run.error}</small>}</div>; })}</div><p className="help">Fetched listings may be excluded because of location, seniority, employment type, duplicate status, or match score.</p></div><div className="panel"><div className="panel-head"><h2>Run log</h2><p>Recent scans are saved on this computer with per-source counts and errors.</p></div><div className="run-log">{state.scanLogs.length ? state.scanLogs.map((log, index) => <details key={`${log.startedAt}-${index}`}><summary><span>{formatDateTime(log.startedAt)}</span><strong>{log.finishedAt ? 'Finished' : 'Running'}</strong></summary><p>{log.summary}</p>{log.sources.length ? <ul>{log.sources.map((source) => <li key={source.id}><strong>{state.searchConfig.sources.find((item) => item.id === source.id)?.name ?? source.id}</strong> · {source.fetched} fetched · {source.matched} matched{source.error ? ` · ${source.error}` : ''}</li>)}</ul> : <p>No source results were recorded.</p>}</details>) : <p className="help">The next scan will appear here.</p>}</div></div></div></>}
      </div>
    </main>

    {selected && <div className="drawer-backdrop" onMouseDown={() => setSelectedId(null)}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-top"><div><div className="eyebrow">{selected.source.toUpperCase()} · {selected.score}% MATCH</div><h2>{selected.title}</h2><p>{selected.company} · {selected.location}</p></div><button className="close" onClick={() => setSelectedId(null)}>×</button></div><div className="drawer-body"><div className="drawer-badges"><span className={`pill ${selected.status}`}>{statusLabel(selected)}</span><span className="tag">{selected.employment}</span><span className="tag">Remote</span></div><div className="detail-section"><h3>Why it matched</h3><ul>{selected.matchReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div><div className="detail-section"><h3>Application path</h3><p>{selected.applicationEmail ? `Send an email to ${selected.applicationEmail}.` : 'This listing uses a form or application page. Open it, use your tailored CV, then mark it applied.'}</p><a href={safeLink(selected.applyUrl)} target="_blank" rel="noreferrer" className="text-link">Open application ↗</a></div><div className="detail-section"><h3>Tailored CV</h3><p>Reorders relevant evidence from your uploaded CV and includes your original experience.</p><a className="button secondary" href={`/api/jobs/${selected.id}/resume`} target="_blank" rel="noreferrer">↓ Download tailored CV</a></div>{selected.applicationEmail && <div className="detail-section"><h3>Email draft</h3><label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={selected.status === 'sent' || selected.status === 'sending'} /></label><label>Message<textarea rows={13} value={body} onChange={(e) => setBody(e.target.value)} disabled={selected.status === 'sent' || selected.status === 'sending'} /></label>{selected.lastError && <p className="inline-error">{selected.lastError}</p>}{selected.status !== 'sent' && selected.status !== 'sending' && <button className="button secondary" disabled={busy === 'saveDraft'} onClick={async () => { if (await action('saveDraft', { id: selected.id, subject, body }, 'saveDraft')) setNotice('Draft saved.'); }}>Save draft</button>}</div>}<div className="detail-section"><h3>Job description</h3><p className="description">{selected.description}</p></div><div className="detail-section"><a href={safeLink(selected.sourceUrl)} target="_blank" rel="noreferrer" className="source-link">View original listing on {selected.source} ↗</a></div>{selected.status === 'dismissed' && selected.dismissReason && <div className="detail-section"><h3>Why this job was removed</h3><p>{dismissOptions.find((option) => option.value === selected.dismissReason)?.label ?? selected.dismissReason}{selected.dismissNote ? ` · ${selected.dismissNote}` : ''}</p></div>}{!['sent', 'applied', 'dismissed', 'sending'].includes(selected.status) && <div className="detail-section feedback-fields"><h3>Not a fit?</h3><label>Reason<select value={dismissReason} onChange={(event) => setDismissReason(event.target.value as DismissReason)}>{dismissOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Note (optional)<textarea rows={2} maxLength={500} value={dismissNote} onChange={(event) => setDismissNote(event.target.value)} placeholder="What was wrong with this listing?" /></label></div>}</div><div className="drawer-actions">{selected.applicationEmail ? <button className="button primary" disabled={!state.gmail.connected || !['ready', 'failed'].includes(selected.status) || busy === 'send'} onClick={async () => { const saved = await action('saveDraft', { id: selected.id, subject, body }, 'saveDraft'); if (saved && await action('send', { id: selected.id }, 'send')) { setNotice('Application email sent.'); setSelectedId(null); } }}>{busy === 'send' ? 'Sending…' : 'Send application'}</button> : selected.status !== 'applied' && <button className="button primary" onClick={async () => { if (await action('status', { id: selected.id, status: 'applied' })) { setNotice('Application marked as submitted.'); setSelectedId(null); } }}>Mark as applied</button>}{!['sent', 'applied', 'dismissed', 'sending'].includes(selected.status) && <button className="button ghost" onClick={async () => { if (await action('status', { id: selected.id, status: 'dismissed', reason: dismissReason, note: dismissNote })) setSelectedId(null); }}>Not a fit</button>}</div></aside></div>}

    {showAdd && <div className="modal-backdrop" onMouseDown={() => setShowAdd(false)}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submitManual}><div className="modal-head"><div><div className="eyebrow">FOUND SOMETHING ELSE?</div><h2>Add a job</h2></div><button type="button" className="close" onClick={() => setShowAdd(false)}>×</button></div><div className="form-grid"><label>Job title<input required value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></label><label>Company<input required value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></label><label>Location eligibility<input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} /></label><label>Employment<select value={manual.employment} onChange={(e) => setManual({ ...manual, employment: e.target.value })}>{employmentOptions.map((x) => <option key={x}>{x}</option>)}</select></label><label className="wide">Application link or mailto address<input required value={manual.applyUrl} onChange={(e) => setManual({ ...manual, applyUrl: e.target.value })} placeholder="https://… or mailto:jobs@company.com" /></label><label className="wide">Job description<textarea required rows={7} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></label></div><button type="submit" className="button primary" disabled={busy === 'addJob'}>Add to queue</button></form></div>}
  </div>;
}
