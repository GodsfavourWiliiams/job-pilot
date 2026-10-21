export type Employment = 'Full time' | 'Part time' | 'Contract';
export type CareerLevel = 'intern' | 'entry' | 'junior' | 'mid' | 'senior' | 'unspecified';
export type JobStatus = 'pending' | 'ready' | 'sending' | 'sent' | 'applied' | 'dismissed' | 'failed';
export type DismissReason = 'not_remote' | 'location' | 'closed' | 'wrong_role' | 'duplicate' | 'other';

export interface Profile {
  name: string;
  professionalTitle: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  timezone: string;
  linkedin: string;
  github: string;
  resumeText: string;
  resumeFileName: string;
}

export interface Preferences {
  searchTerms: string[];
  acceptedLevels: CareerLevel[];
  employment: Employment[];
  reviewBeforeEmail: boolean;
  autoScan: boolean;
  scanIntervalMinutes: 10 | 20 | 30 | 60;
  disabledSources: string[];
  maxEmailsPerDay: number;
  minScore: number;
  browserNotifications: boolean;
}

export interface Draft {
  subject: string;
  body: string;
  highlights: string[];
  createdAt: string;
}

export interface Job {
  id: string;
  source: 'Himalayas' | 'Remotive' | 'Jobicy' | 'Remote OK' | 'Greenhouse' | 'Google' | 'Arbeitnow' | 'We Work Remotely' | 'The Muse' | 'RemoteJobs.org' | 'LinkedIn' | 'Bluesky' | 'X' | 'Manual';
  sourceUrl: string;
  applyUrl: string;
  title: string;
  seniority?: string[];
  level?: CareerLevel;
  timezoneRestrictions?: string[];
  company: string;
  location: string;
  locationVerified?: boolean;
  employment: Employment | 'Unknown';
  description: string;
  publishedAt: string;
  applicationEmail: string;
  score: number;
  matchReasons: string[];
  status: JobStatus;
  dismissReason?: DismissReason;
  dismissNote?: string;
  dismissedAt?: string;
  draft?: Draft;
  sentAt?: string;
  gmailMessageId?: string;
  lastError?: string;
  addedAt: string;
}

export interface Store {
  profile: Profile;
  preferences: Preferences;
  jobs: Job[];
  lastScanAt: string;
  lastScanSummary: string;
  scanStartedAt: string;
  scanFinishedAt: string;
  scanLogs: { startedAt: string; finishedAt: string; summary: string; sources: { id: string; fetched: number; matched: number; error: string }[] }[];
  sourceRuns: Record<string, { lastRunAt: string; lastSuccessAt: string; jobCount: number; matchedCount: number; filtered: Record<string, number>; error: string; warning?: string }>;
  gmail: { connected: boolean; accountEmail: string };
}

export function initialStore(defaults: Omit<Preferences, 'searchTerms'>): Store { return {
  profile: {
    name: '', professionalTitle: '', email: '', phone: '', location: '', country: '', timezone: '',
    linkedin: '', github: '', resumeText: '', resumeFileName: '',
  },
  preferences: {
    searchTerms: [],
    ...defaults,
  },
  jobs: [], lastScanAt: '', lastScanSummary: '', scanStartedAt: '', scanFinishedAt: '', scanLogs: [],
  sourceRuns: {},
  gmail: { connected: false, accountEmail: '' },
}; }
