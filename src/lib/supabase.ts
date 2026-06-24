import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced early so a missing .env is obvious instead of a cryptic network error.
  throw new Error(
    'Faltan variables de entorno de Supabase. Copiá .env.example a .env y ' +
      'completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, luego reiniciá el servidor.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// PostgREST caps a single response at 1000 rows by default, silently. Tables
// that grow as members × matches (predictions) blow past that mid-tournament,
// so reading them with a plain select() drops rows — picks then look
// "completed" in the server-side count yet never render in the listings.
// Page through with .range() until a short page signals the end.
//
// `build` must return a FRESH query each call (builders are single-use) and
// should set a stable .order() so pages don't overlap or skip rows.
const PAGE_SIZE = 1000;

export async function selectAll<T>(
  build: () => PromiseLike<{ data: T[] | null; error: unknown }> & {
    range: (from: number, to: number) => PromiseLike<{
      data: T[] | null;
      error: unknown;
    }>;
  },
): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}
