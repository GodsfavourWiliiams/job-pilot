import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dataPath } from './store';

interface Tokens { refreshToken: string; accountEmail: string }
const tokenFile = dataPath('gmail-token.enc');

function key(): Buffer {
  const value = process.env.TOKEN_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Set TOKEN_ENCRYPTION_KEY to 32 random bytes in hex');
  return Buffer.from(value, 'hex');
}

export function gmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY);
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  await mkdir(dataPath(''), { recursive: true });
  await writeFile(tokenFile, payload, { mode: 0o600 });
}

async function loadTokens(): Promise<Tokens> {
  const payload = await readFile(tokenFile);
  const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as Tokens;
}

export async function removeTokens(): Promise<void> {
  await rm(tokenFile, { force: true });
}

async function tokenRequest(params: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params, signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google token request failed: ${String(body.error ?? response.status)}`);
  return body;
}

export function consentUrl(origin: string, state: string): string {
  if (!gmailConfigured()) throw new Error('Gmail OAuth is not configured');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${origin}/api/gmail/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/gmail.send');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(code: string, origin: string): Promise<Tokens> {
  const body = await tokenRequest(new URLSearchParams({
    code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: `${origin}/api/gmail/callback`, grant_type: 'authorization_code',
  }));
  if (!body.refresh_token || !body.access_token) throw new Error('Google did not return offline access. Reconnect and grant permission.');
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${body.access_token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Could not verify connected Google account');
  const identity = await response.json() as { email?: string; email_verified?: boolean };
  if (!identity.email || !identity.email_verified) throw new Error('Connected Google email was not verified');
  const tokens = { refreshToken: String(body.refresh_token), accountEmail: identity.email };
  await saveTokens(tokens);
  return tokens;
}

function encodeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim();
}

function mimeMessage(to: string, subject: string, body: string, fileName: string, pdf: Uint8Array): string {
  const boundary = `jobpilot_${randomBytes(12).toString('hex')}`;
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const message = [
    `To: ${encodeHeader(to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '', `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '', Buffer.from(body).toString('base64'),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeName}"`,
    `Content-Disposition: attachment; filename="${safeName}"`,
    'Content-Transfer-Encoding: base64',
    '', Buffer.from(pdf).toString('base64'),
    `--${boundary}--`, '',
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
}

export async function sendGmail(to: string, subject: string, body: string, fileName: string, pdf: Uint8Array): Promise<string> {
  const tokens = await loadTokens();
  const refreshed = await tokenRequest(new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: tokens.refreshToken, grant_type: 'refresh_token',
  }));
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${refreshed.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: mimeMessage(to, subject, body, fileName, pdf) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Gmail send failed: HTTP ${response.status}`);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error('Gmail did not return a message ID');
  return result.id;
}
