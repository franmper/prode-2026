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
