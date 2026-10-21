// Next.js compiles this entry point for more than one runtime. Keep Node modules
// behind a conditional import so browser and Edge bundles never follow them.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureScheduler } = await import('./instrumentation-node');
    await ensureScheduler();
  }
}
