import { timingSafeEqual } from 'node:crypto';
import { exchangeCode } from '@/lib/gmail';
import { updateStore } from '@/lib/store';
import { errorResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const received = url.searchParams.get('state') ?? '';
    const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)jobpilot_oauth_state=([^;]+)/)?.[1] ?? '';
    if (!code || !received || !cookie || received.length !== cookie.length || !timingSafeEqual(Buffer.from(received), Buffer.from(cookie))) throw new Error('Google connection state did not match');
    const tokens = await exchangeCode(code, url.origin);
    await updateStore((state) => {
      state.gmail = { connected: true, accountEmail: tokens.accountEmail };
      if (!state.profile.email) state.profile.email = tokens.accountEmail;
    });
    const response = Response.redirect(new URL('/?gmail=connected', url.origin));
    response.headers.append('set-cookie', 'jobpilot_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/gmail; Max-Age=0');
    return response;
  } catch (error) { return errorResponse(error); }
}
