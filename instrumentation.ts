export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { initDB } = await import('./lib/db');
  const { startScheduler } = await import('./lib/scheduler');
  initDB();
  startScheduler();
}
