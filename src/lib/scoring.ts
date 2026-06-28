// Mirrors the SQL: match_points/match_outcome and the round-deadline logic
// (round_first_kickoff / match_lock_at) from the migrations.
// 1-X-2: correct outcome = 1 pt, wrong = 0.

import type { Match, Outcome, Prediction } from './types';

// Argentina is UTC-3 year-round (no DST), so "midnight ARG" == 03:00 UTC.
const ARG_TZ = 'America/Argentina/Buenos_Aires';

export function actualOutcome(
  home: number | null,
  away: number | null,
): Outcome | null {
  if (home == null || away == null) return null;
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

export function matchPoints(
  predicted: Outcome | null,
  home: number | null,
  away: number | null,
): number {
  const actual = actualOutcome(home, away);
  if (!predicted || actual == null) return 0;
  return predicted === actual ? 1 : 0;
}

// Knockout phases: the pick is "who advances" (no draw), decided by the API
// winner (which accounts for extra time / penalties).
const KNOCKOUT_STAGES = new Set([
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
]);

export function isKnockout(stage: string | null): boolean {
  return !!stage && KNOCKOUT_STAGES.has(stage);
}

// The outcome that counts for a match: who advances in knockouts, the 1-X-2
// result of the score in the group stage.
export function actualOutcomeForMatch(m: Match): Outcome | null {
  if (isKnockout(m.stage)) return m.winner;
  return actualOutcome(m.home_score, m.away_score);
}

export function matchPointsForMatch(
  predicted: Outcome | null,
  m: Match,
): number {
  const actual = actualOutcomeForMatch(m);
  if (!predicted || actual == null) return 0;
  return predicted === actual ? 1 : 0;
}

// First kickoff of the round this match belongs to.
// Group stage: earliest match sharing the same matchday (Fecha).
// Knockouts: earliest match of the same phase (Stage) — the whole phase
// locks together, just like a group-stage Fecha.
function roundFirstKickoff(match: Match, all: Match[]): string {
  // Which matches lock together with this one: same Fecha in the group stage,
  // same phase in the knockouts.
  let sameRound: ((x: Match) => boolean) | null = null;
  if (match.stage === 'GROUP_STAGE' && match.matchday != null) {
    sameRound = (x) =>
      x.stage === 'GROUP_STAGE' && x.matchday === match.matchday;
  } else if (match.stage && match.stage !== 'GROUP_STAGE') {
    sameRound = (x) => x.stage === match.stage;
  }
  if (!sameRound) return match.kickoff_at;

  let first = match.kickoff_at;
  for (const x of all) {
    if (sameRound(x) && x.kickoff_at < first) first = x.kickoff_at;
  }
  return first;
}

// When predictions lock.
// Group stage: midnight (ARG) of the day the round starts — i.e. editable
//   until 23:59 ARG the day before.
// Knockouts: 5 minutes before the first match of the phase.
export function lockAt(match: Match, all: Match[]): Date {
  const first = new Date(roundFirstKickoff(match, all));
  // Anything that isn't the group stage (incl. a null stage) locks 5 min before
  // the phase's first match — mirrors match_lock_at's `else` branch in SQL.
  if (match.stage !== 'GROUP_STAGE') {
    return new Date(first.getTime() - 5 * 60 * 1000); // 5 min before kickoff
  }
  const argDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARG_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(first); // e.g. "2026-06-15"
  return new Date(`${argDay}T03:00:00.000Z`); // 00:00 ARG of that day
}

export function isLocked(match: Match, all: Match[]): boolean {
  return match.status !== 'scheduled' || Date.now() >= lockAt(match, all).getTime();
}

// The ARG calendar day (YYYY-MM-DD) for an instant; defaults to "now".
export function argDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ARG_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// True if the kickoff falls on the current ARG calendar day.
export function isToday(iso: string): boolean {
  return argDay(new Date(iso)) === argDay();
}

const STAGE_ES: Record<string, string> = {
  GROUP_STAGE: 'Fase de grupos',
  LAST_32: 'Dieciseisavos',
  LAST_16: 'Octavos',
  QUARTER_FINALS: 'Cuartos',
  SEMI_FINALS: 'Semifinal',
  THIRD_PLACE: 'Tercer puesto',
  FINAL: 'Final',
};

// Fallback for unknown codes: "SOME_STAGE" -> "Some stage"
function humanize(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function stageLabel(stage: string | null): string {
  if (!stage) return 'Partido';
  return STAGE_ES[stage] ?? humanize(stage);
}

export function roundLabel(m: Match): string {
  if (m.stage === 'GROUP_STAGE' && m.matchday != null) return `Fecha ${m.matchday}`;
  return stageLabel(m.stage);
}

// "GROUP_J" / "Group J" / "GROUP_A" -> "Grupo J"
export function groupLabel(group: string | null): string | null {
  if (!group) return null;
  const m = group.match(/^group[_\s]?([A-Za-z0-9]+)$/i);
  return m ? `Grupo ${m[1].toUpperCase()}` : group;
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: ARG_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Show the deadline the way users think of it: 23:59 the day before.
export function formatDeadline(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: ARG_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(d.getTime() - 60_000));
}

// ---------------------------------------------------------------------------
//  Per-fecha (per-round) points breakdown for the leaderboard.
//  A "round" is a Fecha (matchday) in the group stage, or a phase in the
//  knockouts. Mirrors get_leaderboard's formula (stage weight × ×2 comodín),
//  but computed client-side over finished matches only.
// ---------------------------------------------------------------------------

// Column header order: group fechas first (by matchday), then knockouts.
const KNOCKOUT_ORDER: Record<string, number> = {
  LAST_32: 101,
  LAST_16: 102,
  QUARTER_FINALS: 103,
  SEMI_FINALS: 104,
  THIRD_PLACE: 105,
  FINAL: 106,
};

// Short header labels so the columns stay narrow.
const KNOCKOUT_SHORT: Record<string, string> = {
  LAST_32: 'R32',
  LAST_16: 'R16',
  QUARTER_FINALS: '4tos',
  SEMI_FINALS: 'Semi',
  THIRD_PLACE: '3°',
  FINAL: 'Final',
};

export interface RoundColumn {
  key: string; // 'GROUP_STAGE:1' | 'LAST_16' | …
  order: number;
  label: string; // short header, e.g. 'F1', 'R16'
  title: string; // full name, e.g. 'Fecha 1', 'Octavos'
  matchCount: number; // total matches in this round (any status)
}

function roundKeyForMatch(m: Match): string {
  if (m.stage === 'GROUP_STAGE') return `GROUP_STAGE:${m.matchday ?? 0}`;
  return m.stage ?? 'OTHER';
}

function roundColumn(key: string, matchCount: number): RoundColumn {
  if (key.startsWith('GROUP_STAGE:')) {
    const md = key.slice('GROUP_STAGE:'.length);
    return { key, order: Number(md) || 0, label: `F${md}`, title: `Fecha ${md}`, matchCount };
  }
  return {
    key,
    order: KNOCKOUT_ORDER[key] ?? 200,
    label: KNOCKOUT_SHORT[key] ?? stageLabel(key),
    title: stageLabel(key),
    matchCount,
  };
}

// Per-round (and total) stats for one player.
export interface RoundStat {
  points: number; // points scored (stage weight × ×2 comodín)
  correct: number; // aciertos
  finished: number; // pronósticos sobre partidos finalizados
  made: number; // pronósticos hechos (cualquier estado visible)
}

export function emptyStat(): RoundStat {
  return { points: 0, correct: 0, finished: 0, made: 0 };
}

export interface UserBreakdown {
  perRound: Map<string, RoundStat>; // roundKey -> stat
  total: RoundStat;
}

export interface RoundBreakdown {
  // Ordered columns to render (only rounds with a finished match).
  columns: RoundColumn[];
  // stats = byUser.get(userId)
  byUser: Map<string, UserBreakdown>;
}

// Compute each player's stats per round. `predictions` should be all visible
// predictions (own + liga-mates' revealed after lock); `doubled` holds the
// `${userId}|${matchId}` keys that have an active ×2.
export function roundPointsBreakdown(
  matches: Match[],
  predictions: Prediction[],
  stagePoints: Record<string, number>,
  doubled: Set<string>,
): RoundBreakdown {
  const matchById = new Map(matches.map((m) => [m.id, m]));

  // Total matches per round (any status) — denominator for "pronósticos hechos".
  const matchCount = new Map<string, number>();
  for (const m of matches) {
    const key = roundKeyForMatch(m);
    matchCount.set(key, (matchCount.get(key) ?? 0) + 1);
  }

  // Columns come from finished matches, so a fecha shows up even if everyone
  // scored 0 in it.
  const cols = new Map<string, RoundColumn>();
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const key = roundKeyForMatch(m);
    if (!cols.has(key)) cols.set(key, roundColumn(key, matchCount.get(key) ?? 0));
  }
  const columns = [...cols.values()].sort((a, b) => a.order - b.order);

  const byUser = new Map<string, UserBreakdown>();
  for (const p of predictions) {
    const m = matchById.get(p.match_id);
    if (!m) continue;
    const key = roundKeyForMatch(m);

    let user = byUser.get(p.user_id);
    if (!user) byUser.set(p.user_id, (user = { perRound: new Map(), total: emptyStat() }));
    let stat = user.perRound.get(key);
    if (!stat) user.perRound.set(key, (stat = emptyStat()));

    // Every visible pick counts toward "pronósticos hechos".
    stat.made += 1;
    user.total.made += 1;

    if (m.status !== 'finished') continue;

    const base = matchPointsForMatch(p.predicted_outcome, m);
    const weight = stagePoints[m.stage ?? ''] ?? 1;
    const mult = doubled.has(`${p.user_id}|${m.id}`) ? 2 : 1;
    const pts = base * weight * mult;

    stat.finished += 1;
    stat.correct += base; // base is 1 on a correct pick, 0 otherwise
    stat.points += pts;
    user.total.finished += 1;
    user.total.correct += base;
    user.total.points += pts;
  }

  return { columns, byUser };
}
