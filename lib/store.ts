import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSearchConfig } from './config';
import { initialStore, type Store } from './types';

const dataDir = path.join(process.cwd(), 'data');
const statePath = path.join(dataDir, 'state.json');
let updates: Promise<unknown> = Promise.resolve();

export async function readStore(): Promise<Store> {
  const defaults = initialStore((await loadSearchConfig()).defaults);
  try {
    const data = JSON.parse(await readFile(statePath, 'utf8')) as Store;
    return {
      ...defaults, ...data,
      profile: { ...defaults.profile, ...data.profile },
      preferences: { ...defaults.preferences, ...data.preferences },
      gmail: { ...defaults.gmail, ...data.gmail },
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
      scanLogs: Array.isArray(data.scanLogs) ? data.scanLogs : [],
      sourceRuns: data.sourceRuns && typeof data.sourceRuns === 'object' ? data.sourceRuns : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaults;
  }
}

export async function updateStore<T>(fn: (state: Store) => T | Promise<T>): Promise<T> {
  const task = updates.then(async () => {
    const state = await readStore();
    const result = await fn(state);
    await mkdir(dataDir, { recursive: true });
    const tempPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(tempPath, statePath);
    return result;
  });
  updates = task.catch(() => undefined);
  return task;
}

export function dataPath(fileName: string): string {
  return path.join(dataDir, fileName);
}
