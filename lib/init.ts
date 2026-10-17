import { initDB } from '@/lib/db';
import { initDefaultUser } from '@/lib/auth';

let initialized = false;

export function ensureInitialized() {
  if (initialized) return;
  initDB();
  initDefaultUser();
  initialized = true;
}

export default ensureInitialized;
