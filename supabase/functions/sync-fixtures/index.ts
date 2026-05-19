// Supabase Edge Function: sync World Cup 2026 fixtures + results.
//
// Pulls the FIFA World Cup competition from football-data.org and upserts
// every match into public.matches (deduped by api_id). Runs with the service
// role, so it bypasses RLS — clients never call the football API directly.
//
// Required secrets (see README):
//   FOOTBALL_API_KEY            your football-data.org token
//   SUPABASE_URL                (auto-injected by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected by Supabase)
//
// Invoke manually:  supabase functions invoke sync-fixtures
// Or schedule it with pg_cron (see README).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// FIFA World Cup competition code on football-data.org
const COMPETITION = 'WC';

type FdStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'FINISHED'
  | 'SUSPENDED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'AWARDED';

interface FdMatch {
  id: number;
  utcDate: string;
  status: FdStatus;
  stage: string | null;
  group: string | null;
  matchday: number | null;
  homeTeam: { name: string | null };
  awayTeam: { name: string | null };
  score: { fullTime: { home: number | null; away: number | null } };
}

function mapStatus(s: FdStatus): 'scheduled' | 'live' | 'finished' {
  if (s === 'FINISHED' || s === 'AWARDED') return 'finished';
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live';
  return 'scheduled';
}

// CORS so the browser (owner "Sincronizar fixture" button) can call this.
// curl/pg_cron don't need it but it's harmless for them.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // Browser preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const apiKey = Deno.env.get('FOOTBALL_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!apiKey || !supabaseUrl || !serviceKey) {
    return json({ error: 'Missing FOOTBALL_API_KEY or Supabase env' }, 500);
  }

  const res = await fetch(
    `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`,
    { headers: { 'X-Auth-Token': apiKey } },
  );

  if (!res.ok) {
    return json(
      { error: `Football API ${res.status}`, body: await res.text() },
      502,
    );
  }

  const json = (await res.json()) as { matches: FdMatch[] };
  const matches = json.matches ?? [];

  const rows = matches
    .filter((m) => m.homeTeam?.name && m.awayTeam?.name)
    .map((m) => ({
      api_id: m.id,
      stage: m.stage,
      group_name: m.group,
      matchday: m.matchday ?? null,
      home_team: m.homeTeam.name,
      away_team: m.awayTeam.name,
      kickoff_at: m.utcDate,
      home_score: m.score?.fullTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? null,
      status: mapStatus(m.status),
    }));

  const supabase = createClient(supabaseUrl, serviceKey);
  const { error } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'api_id' });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ synced: rows.length, total_from_api: matches.length });
});
