import { performScan } from './lib/service';
import { loadSearchConfig } from './lib/config';
import { readStore } from './lib/store';

declare global {
  var jobPilotInterval: ReturnType<typeof setInterval> | undefined;
  var jobPilotSchedulerSetup: Promise<void> | undefined;
  var jobPilotSchedulerVersion: number | undefined;
}

const schedulerVersion = 3;

async function scanIfDue(): Promise<void> {
  try {
    const state = await readStore();
    const last = state.lastScanAt ? Date.parse(state.lastScanAt) : 0;
    if (!state.preferences.autoScan || !state.profile.resumeText || Date.now() - last < state.preferences.scanIntervalMinutes * 60 * 1000) return;
    await performScan();
  } catch (error) { console.error('Job scan failed:', error); }
}

/** Safe to call from instrumentation or a dashboard request after dev hot reload. */
export async function ensureScheduler(): Promise<void> {
  if (globalThis.jobPilotInterval && globalThis.jobPilotSchedulerVersion === schedulerVersion && globalThis.jobPilotInterval.hasRef?.()) return;
  if (globalThis.jobPilotSchedulerSetup) return globalThis.jobPilotSchedulerSetup;
  globalThis.jobPilotSchedulerSetup = (async () => {
    if (globalThis.jobPilotInterval) clearInterval(globalThis.jobPilotInterval);
    const config = await loadSearchConfig();
    globalThis.jobPilotInterval = setInterval(scanIfDue, config.schedule.checkEveryMinutes * 60 * 1000);
    globalThis.jobPilotSchedulerVersion = schedulerVersion;
    setTimeout(scanIfDue, 10_000);
  })().finally(() => { globalThis.jobPilotSchedulerSetup = undefined; });
  return globalThis.jobPilotSchedulerSetup;
}
