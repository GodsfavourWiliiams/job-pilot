export async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.json();
}
