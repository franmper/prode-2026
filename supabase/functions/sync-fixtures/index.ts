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
  homeTeam: { name: string | null };
  awayTeam: { name: string | null };
  score: { fullTime: { home: number | null; away: number | null } };
}

function mapStatus(s: FdStatus): 'scheduled' | 'live' | 'finished' {
  if (s === 'FINISHED' || s === 'AWARDED') return 'finished';
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live';
  return 'scheduled';
}

Deno.serve(async () => {
  const apiKey = Deno.env.get('FOOTBALL_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!apiKey || !supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'Missing FOOTBALL_API_KEY or Supabase env' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const res = await fetch(
    `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`,
    { headers: { 'X-Auth-Token': apiKey } },
  );

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `Football API ${res.status}`, body: await res.text() }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ synced: rows.length, total_from_api: matches.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
