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
  score: {
    // winner already accounts for extra time and penalties (who advances).
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    fullTime: { home: number | null; away: number | null };
  };
}

// A match is "complete" once it has a result recorded — a final score (group
// stage) or a decided winner (knockouts).
interface ExistingMatch {
  id: string;
  api_id: number | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  winner: string | null;
}

function isComplete(m: ExistingMatch): boolean {
  return (m.home_score != null && m.away_score != null) || m.winner != null;
}

// Does the API payload carry an actual result for this match (a final score or
// a decided winner)? The single-match endpoint returns real scores even on the
// free tier, so this lets a per-match sync overwrite a hand-entered result —
// but only when there's something real to write (never wipe it back to null).
function apiHasResult(m: FdMatch): boolean {
  return (
    (m.score?.fullTime?.home != null && m.score?.fullTime?.away != null) ||
    m.score?.winner != null
  );
}

const teamKey = (h: string | null, a: string | null) =>
  `${(h ?? '').trim().toLowerCase()}|${(a ?? '').trim().toLowerCase()}`;

// Owner-created matches (api_id NULL) are "adopted" when the API finally brings
// the same fixture: we stamp our row with the real api_id, matched by the two
// team names, so the upsert updates it in place instead of inserting a copy.
// A manually-completed match stays manual (we don't auto-merge a result).
function planClaims(
  existing: ExistingMatch[],
  apiMatches: FdMatch[],
): { id: string; api_id: number }[] {
  const knownApiIds = new Set(
    existing.map((m) => m.api_id).filter((v) => v != null),
  );
  const manualByTeams = new Map<string, string>();
  for (const m of existing) {
    if (m.api_id == null && !isComplete(m)) {
      manualByTeams.set(teamKey(m.home_team, m.away_team), m.id);
    }
  }

  const claims: { id: string; api_id: number }[] = [];
  for (const m of apiMatches) {
    if (!m.homeTeam?.name || !m.awayTeam?.name || knownApiIds.has(m.id)) continue;
    const key = teamKey(m.homeTeam.name, m.awayTeam.name);
    const localId = manualByTeams.get(key);
    if (localId) {
      claims.push({ id: localId, api_id: m.id });
      manualByTeams.delete(key); // one-to-one
    }
  }
  return claims;
}

function mapStatus(s: FdStatus): 'scheduled' | 'live' | 'finished' {
  if (s === 'FINISHED' || s === 'AWARDED') return 'finished';
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live';
  return 'scheduled';
}

// Normalize the API winner to our 1-X-2 vocabulary (null until decided).
function mapWinner(w: FdMatch['score']['winner']): 'home' | 'away' | 'draw' | null {
  if (w === 'HOME_TEAM') return 'home';
  if (w === 'AWAY_TEAM') return 'away';
  if (w === 'DRAW') return 'draw';
  return null;
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

// Optional request body: { api_id } restricts the sync to that single match
// (used by the per-match "Sincronizar" button). No body → full sync.
async function readSingleApiId(req: Request): Promise<number | null> {
  try {
    const body = await req.json();
    return typeof body?.api_id === 'number' ? body.api_id : null;
  } catch {
    return null; // no body
  }
}

// football-data.org occasionally resets the connection (os error 104),
// especially on the free tier. Retry a few times with a short backoff before
// giving up — a thrown fetch (network error) is transient, a non-2xx is not.
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// Pull matches from football-data.org: the whole competition, or just one match
// when singleApiId is given. Returns an error Response on a non-2xx API reply.
async function fetchFixtures(
  apiKey: string,
  singleApiId: number | null,
): Promise<{ error: Response } | { matches: FdMatch[] }> {
  const url = singleApiId == null
    ? `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`
    : `https://api.football-data.org/v4/matches/${singleApiId}`;

  const res = await fetchWithRetry(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) {
    return {
      error: json({ error: `Football API ${res.status}`, body: await res.text() }, 502),
    };
  }

  // The list endpoint wraps matches in { matches: [...] }; the single-match
  // endpoint returns the match resource at the top level.
  const payload = await res.json();
  if (singleApiId == null) {
    return { matches: (payload?.matches as FdMatch[]) ?? [] };
  }
  return { matches: payload?.id ? [payload as FdMatch] : [] };
}

Deno.serve(async (req) => {
  // Browser preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
  const apiKey = Deno.env.get('FOOTBALL_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!apiKey || !supabaseUrl || !serviceKey) {
    return json({ error: 'Missing FOOTBALL_API_KEY or Supabase env' }, 500);
  }

  const singleApiId = await readSingleApiId(req);
  const fetched = await fetchFixtures(apiKey, singleApiId);
  if ('error' in fetched) {
    return fetched.error;
  }
  const matches = fetched.matches;

  const supabase = createClient(supabaseUrl, serviceKey);

  // The free football-data tier returns FINISHED with null scores, so results
  // are entered by hand; we must never let a later sync overwrite a complete
  // match back to nulls. Skip those api_ids in the upsert below.
  const { data: existing, error: exErr } = await supabase
    .from('matches')
    .select('id, api_id, home_team, away_team, home_score, away_score, winner');
  if (exErr) {
    return json({ error: exErr.message }, 500);
  }
  const existingRows = (existing ?? []) as ExistingMatch[];

  const complete = new Set(
    existingRows
      .filter(isComplete)
      .map((m) => m.api_id)
      .filter((v) => v != null),
  );

  // Adopt hand-created matches the API now publishes (see planClaims): stamp
  // our row with the real api_id so the upsert updates it, not duplicates it.
  const claims = planClaims(existingRows, matches);
  for (const c of claims) {
    const { error: cErr } = await supabase
      .from('matches')
      .update({ api_id: c.api_id })
      .eq('id', c.id);
    if (cErr) {
      return json({ error: cErr.message }, 500);
    }
  }

  const rows = matches
    .filter((m) => m.homeTeam?.name && m.awayTeam?.name)
    .filter((m) => {
      // Not yet complete locally → always sync from the API.
      if (!complete.has(m.id)) return true;
      // Already complete locally: the full sync (list endpoint) must never
      // overwrite — it returns null scores on the free tier. A per-match sync
      // hits the single-match endpoint (real scores), so it may overwrite, but
      // only when the API actually has a result (don't wipe it back to null).
      return singleApiId != null && apiHasResult(m);
    })
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
      winner: mapWinner(m.score?.winner ?? null),
      status: mapStatus(m.status),
    }));

  const { error } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'api_id' });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({
    synced: rows.length,
    linked: claims.length,
    skipped_complete: complete.size,
    total_from_api: matches.length,
  });
  } catch (e) {
    // Surface the real error as JSON+CORS instead of an opaque 500.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
