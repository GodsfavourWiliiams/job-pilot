import { addManualJob, changeStatus, disconnectGmail, performScan, prepareJob, saveDraft, savePreferences, saveProfile, sendApplication } from '@/lib/service';
import { errorResponse, requireLocalMutation } from '@/lib/http';
import { readStore } from '@/lib/store';
import type { JobStatus, Preferences, Profile } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    requireLocalMutation(request);
    if (Number(request.headers.get('content-length') ?? 0) > 200_000) throw new Error('Request too large');
    const input = await request.json() as Record<string, unknown>;
    let result: unknown = null;
    switch (input.action) {
      case 'profile': await saveProfile(input.data as Partial<Profile>); break;
      case 'preferences': await savePreferences(input.data as Partial<Preferences>); break;
      case 'scan': result = await performScan(); break;
      case 'addJob': result = await addManualJob(input.data as Record<string, unknown>); break;
      case 'prepare': await prepareJob(String(input.id)); break;
      case 'saveDraft': await saveDraft(String(input.id), String(input.subject ?? ''), String(input.body ?? '')); break;
      case 'send': result = await sendApplication(String(input.id)); break;
      case 'disconnectGmail': await disconnectGmail(); break;
      case 'status': await changeStatus(String(input.id), String(input.status) as JobStatus, String(input.reason ?? ''), String(input.note ?? '')); break;
      default: throw new Error('Unknown action');
    }
    return Response.json({ ok: true, result, state: await readStore() });
  } catch (error) {
    return errorResponse(error);
  }
}
