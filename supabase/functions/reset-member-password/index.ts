// Owner-only password reset (no email).
//
// The liga owner calls this for a member; we set a random temporary
// password via the admin API and return it so the owner can pass it on.
// Authorization is enforced HERE (server-side) — the client gate is just UX.
//
// Required env (auto-injected by Supabase): SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Readable temp password, no ambiguous chars.
function tempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) {
      return reply({ error: 'Faltan variables de entorno de Supabase' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return reply({ error: 'No autenticado' }, 401);
    }

    const { pool_id, target_user_id } = await req.json();
    if (!pool_id || !target_user_id) {
      return reply({ error: 'Faltan pool_id o target_user_id' }, 400);
    }

    // Who is calling? (validate the caller's JWT)
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: caller } = await callerClient.auth.getUser();
    if (!caller?.user) {
      return reply({ error: 'Sesión inválida' }, 401);
    }

    const admin = createClient(url, serviceKey);

    // Caller must be the OWNER of this liga.
    const { data: pool, error: poolErr } = await admin
      .from('pools')
      .select('owner_id')
      .eq('id', pool_id)
      .single();
    if (poolErr || !pool) {
      return reply({ error: 'Liga no encontrada' }, 404);
    }
    if (pool.owner_id !== caller.user.id) {
      return reply(
        { error: 'Solo el dueño de la liga puede resetear contraseñas' },
        403,
      );
    }

    // Target must be a member of this liga.
    const { data: member } = await admin
      .from('pool_members')
      .select('user_id')
      .eq('pool_id', pool_id)
      .eq('user_id', target_user_id)
      .maybeSingle();
    if (!member) {
      return reply({ error: 'Ese usuario no es miembro de la liga' }, 400);
    }

    const password = tempPassword();
    const { error: updErr } = await admin.auth.admin.updateUserById(
      target_user_id,
      { password },
    );
    if (updErr) {
      return reply({ error: updErr.message }, 500);
    }

    return reply({ password });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
