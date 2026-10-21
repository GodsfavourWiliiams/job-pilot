import { gmailConfigured } from '@/lib/gmail';
import { effectiveQueries, loadSearchConfig, sourceLinks } from '@/lib/config';
import { readStore } from '@/lib/store';
import { effectiveCareerLevels } from '@/lib/match';
import { ensureScheduler } from '@/instrumentation-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  void ensureScheduler().catch((error) => console.error('Scheduler setup failed:', error));
  const state = await readStore();
  const config = await loadSearchConfig();
  return Response.json({
    ...state,
    gmailConfigured: gmailConfigured(),
    searchConfig: {
      sources: sourceLinks(config),
      effectiveQueries: effectiveQueries(config, state.preferences, state.profile),
      effectiveLevels: effectiveCareerLevels(state.profile, state.preferences),
      sourceCooldownMinutes: config.schedule.sourceCooldownMinutes,
    },
  });
}
