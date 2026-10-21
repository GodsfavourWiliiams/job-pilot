export function requireLocalMutation(request: Request): void {
  const header = request.headers.get('x-job-pilot');
  if (header !== '1') throw new Error('Missing application request header');
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  if (origin && new URL(origin).host !== requestUrl.host) throw new Error('Cross-origin request blocked');
  if (!['127.0.0.1', 'localhost'].includes(requestUrl.hostname)) throw new Error('This version must run locally');
}

export function errorResponse(error: unknown, status = 400): Response {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}
