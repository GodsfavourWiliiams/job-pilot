import { randomBytes } from 'node:crypto';
import { consentUrl } from '@/lib/gmail';
import { errorResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Gmail connection is local only');
    const state = randomBytes(24).toString('hex');
    const response = Response.redirect(consentUrl(url.origin, state));
    response.headers.append('set-cookie', `jobpilot_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/gmail; Max-Age=600`);
    return response;
  } catch (error) { return errorResponse(error); }
}
