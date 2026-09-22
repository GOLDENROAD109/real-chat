import { createSupabaseStore } from './supabase.js';
import { createDemoStore } from './demo.js';

/**
 * Pick the data layer:
 *  - Supabase when SUPABASE_URL + key are configured (and reachable)
 *  - Local demo JSON store otherwise, so the MVP always runs
 */
export async function initDb() {
  const hasSupabase =
    process.env.SUPABASE_URL?.trim() &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim());

  if (hasSupabase) {
    try {
      const store = await createSupabaseStore();
      await store.ping();
      console.log('🔵 Connected to Supabase — persistent storage enabled');
      return { mode: 'supabase', store };
    } catch (err) {
      console.warn('⚠️  Supabase unavailable, falling back to demo mode.');
      console.warn('    Reason:', err.message);
      console.warn('    Hint: run supabase/schema.sql in your project and check the keys in .env');
    }
  } else {
    console.log('ℹ️  SUPABASE_URL not set — running in demo mode (local JSON store)');
  }

  const store = await createDemoStore();
  return { mode: 'demo', store };
}
