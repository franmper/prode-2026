import { useCallback, useEffect, useState } from 'react';
import { supabase, selectAll } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Match, Prediction, Outcome } from '../lib/types';
import { teamName, teamFlag } from '../lib/countries';
import {
  matchPointsForMatch,
  actualOutcomeForMatch,
  isKnockout,
  isLocked,
  isToday,
  formatKickoff,
  roundLabel,
  groupLabel,
  stageLabel,
  lockAt,
  formatDeadline,
} from '../lib/scoring';

const STAGE_ORDER = [
  'GROUP_STAGE',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
];

// Stages where the comodín ×2 may be used (Dieciseisavos → Semifinal).
const DOBLE_STAGES = new Set([
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
]);

interface Member {
  id: string;
  display_name: string;
}

// One tab: a Fecha (group stage) or a knockout phase.
interface Section {
  key: string;
  title: string;
  tabLabel: string;
  matches: Match[];
}

// Colored badge that tells you, at a glance, if your pick landed and how
// many points it earned this liga.
function ResultBadge({
  correct,
  pts,
}: Readonly<{ correct: boolean | null; pts: number | null }>) {
  if (correct === true) {
    return (
      <span className="result-badge ok">
        ✓ Acertaste — sumaste {pts} {pts === 1 ? 'pt' : 'pts'}
      </span>
    );
  }
  if (correct === false) {
    return <span className="result-badge no">✗ No acertaste</span>;
  }
  return <span className="result-badge none">Sin pronóstico</span>;
}

export function MatchList({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [myPreds, setMyPreds] = useState<Record<string, Prediction>>({});
  // matchId -> { userId -> predicted_outcome } across this liga's members.
  const [picksByMatch, setPicksByMatch] = useState<
    Record<string, Record<string, Outcome>>
  >({});
  const [members, setMembers] = useState<Member[]>([]);
  // stage -> points this liga awards for a correct outcome (default 1).
  const [stagePoints, setStagePoints] = useState<Record<string, number>>({});
  // Comodín ×2 per-phase config + picks. stage -> { enabled, count }.
  const [dobleConfig, setDobleConfig] = useState<
    Record<string, { enabled: boolean; count: number }>
  >({});
  const [myDoubles, setMyDoubles] = useState<Set<string>>(new Set());
  // matchId -> set of member userIds that doubled it (revealed after lock).
  const [doublesByMatch, setDoublesByMatch] = useState<
    Record<string, Set<string>>
  >({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Selected tab. Null -> fall back to the first section with open matches.
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mRes, pRes, pmRes, spRes, psRes, mdRes] = await Promise.all([
      supabase.from('matches').select('*').order('kickoff_at'),
      selectAll<Prediction>(() =>
        supabase.from('predictions').select('*').order('id'),
      ),
      supabase.from('pool_members').select('user_id').eq('pool_id', poolId),
      supabase
        .from('pool_stage_points')
        .select('stage, points')
        .eq('pool_id', poolId),
      supabase
        .from('pool_stage_doubles')
        .select('stage, enabled, count')
        .eq('pool_id', poolId),
      supabase
        .from('match_doubles')
        .select('user_id, match_id')
        .eq('pool_id', poolId),
    ]);
    if (mRes.error) setError(mRes.error.message);
    setMatches((mRes.data as Match[]) ?? []);

    const sp: Record<string, number> = {};
    for (const r of (spRes.data as { stage: string; points: number }[]) ?? []) {
      sp[r.stage] = r.points;
    }
    setStagePoints(sp);

    const dc: Record<string, { enabled: boolean; count: number }> = {};
    for (const r of (psRes.data as {
      stage: string;
      enabled: boolean;
      count: number;
    }[]) ?? []) {
      dc[r.stage] = { enabled: r.enabled, count: r.count };
    }
    setDobleConfig(dc);

    // My ×2 picks + everyone's (visible ones reveal after each match locks).
    const mineD = new Set<string>();
    const byMatch: Record<string, Set<string>> = {};
    for (const r of (mdRes.data as { user_id: string; match_id: string }[]) ??
      []) {
      if (r.user_id === user?.id) mineD.add(r.match_id);
      (byMatch[r.match_id] ??= new Set()).add(r.user_id);
    }
    setMyDoubles(mineD);
    setDoublesByMatch(byMatch);

    // Liga members + their display names.
    const memberIds = (pmRes.data ?? []).map(
      (r: { user_id: string }) => r.user_id,
    );
    let mem: Member[] = [];
    if (memberIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', memberIds);
      mem = (profs as Member[]) ?? [];
      mem.sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'));
    }
    setMembers(mem);
    const memberSet = new Set(mem.map((x) => x.id));

    // Split predictions: own ones (regardless of liga) drive the UI state;
    // visible ones from this liga's members feed the post-lock reveal.
    const mine: Record<string, Prediction> = {};
    const picks: Record<string, Record<string, Outcome>> = {};
    for (const row of pRes.data) {
      if (row.user_id === user?.id) mine[row.match_id] = row;
      if (memberSet.has(row.user_id)) {
        (picks[row.match_id] ??= {})[row.user_id] = row.predicted_outcome;
      }
    }
    setMyPreds(mine);
    setPicksByMatch(picks);
    setLoading(false);
  }, [poolId, user?.id]);

  useEffect(() => {
    load();
    // Refresca cuando cambian los partidos (status/score -> nuevos locks
    // habilitan ver pronósticos del resto).
    const channel = supabase
      .channel(`matches-${poolId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, poolId]);

  async function pick(match: Match, outcome: Outcome) {
    if (!user || savingId) return;
    setSavingId(match.id);
    setError('');
    const { error } = await supabase.from('predictions').upsert(
      { user_id: user.id, match_id: match.id, predicted_outcome: outcome },
      { onConflict: 'user_id,match_id' },
    );
    if (error) setError(error.message);
    else await load();
    setSavingId(null);
  }

  async function toggleDouble(match: Match) {
    if (!user || savingId) return;
    setSavingId(match.id);
    setError('');
    const { error } = await supabase.rpc('set_match_double', {
      p_pool_id: poolId,
      p_match_id: match.id,
      p_on: !myDoubles.has(match.id),
    });
    if (error) setError(error.message);
    else await load();
    setSavingId(null);
  }

  const flagImg = (raw: string | null | undefined) => {
    const src = teamFlag(raw);
    if (!src) return null;
    return <img className="flag" src={src} alt="" aria-hidden="true" />;
  };

  const teamWithFlag = (raw: string | null | undefined) => (
    <>
      {flagImg(raw)}
      <span className="team-name">{teamName(raw)}</span>
    </>
  );

  // Verb: knockouts are about who advances ("Pasa"), group stage who wins.
  const verb = (m: Match) => (isKnockout(m.stage) ? 'Pasa' : 'Gana');

  // Buttons: only the flag ("Gana/Pasa {flag}").
  const winLabel = (m: Match, raw: string | null | undefined) => (
    <>
      {verb(m)} {flagImg(raw)}
    </>
  );

  const label = (m: Match, o: Outcome) =>
    o === 'home'
      ? winLabel(m, m.home_team)
      : o === 'away'
        ? winLabel(m, m.away_team)
        : 'Empate';

  // Reveal rows keep the country name alongside the flag for clarity.
  const winLabelFull = (m: Match, raw: string | null | undefined) => (
    <>
      {verb(m)} {flagImg(raw)}
      {teamName(raw)}
    </>
  );

  const labelFull = (m: Match, o: Outcome) =>
    o === 'home'
      ? winLabelFull(m, m.home_team)
      : o === 'away'
        ? winLabelFull(m, m.away_team)
        : 'Empate';

  // What a correct outcome in this match is worth for this liga (default 1).
  const worth = (m: Match) => stagePoints[m.stage ?? ''] ?? 1;

  // How many of my ×2 picks are already spent, per phase.
  const mySpentByStage: Record<string, number> = {};
  for (const m of matches) {
    if (myDoubles.has(m.id) && m.stage) {
      mySpentByStage[m.stage] = (mySpentByStage[m.stage] ?? 0) + 1;
    }
  }

  function renderMatch(m: Match) {
    const locked = isLocked(m, matches);
    const myPred = myPreds[m.id];
    const finished = m.status === 'finished';
    // A finished match can still lack a recorded result (the free API marks it
    // FINISHED before the score lands). Only score / show the badge once the
    // outcome is actually known.
    const hasResult = finished && actualOutcomeForMatch(m) != null;
    const doubled = myDoubles.has(m.id);
    const stage = m.stage ?? '';
    const cfg = dobleConfig[stage];
    const canDouble = !!cfg?.enabled && DOBLE_STAGES.has(stage);
    const stageRemaining = Math.max(
      0,
      (cfg?.count ?? 0) - (mySpentByStage[stage] ?? 0),
    );
    const myPts = hasResult && myPred
      ? matchPointsForMatch(myPred.predicted_outcome, m) *
        worth(m) *
        (doubled ? 2 : 1)
      : null;
    // Did my pick land? Only meaningful once the result is known.
    const myCorrect =
      hasResult && myPred
        ? matchPointsForMatch(myPred.predicted_outcome, m) === 1
        : null;
    // Knockouts: pick who advances (no draw). Group stage: 1-X-2.
    const options: Outcome[] = isKnockout(m.stage)
      ? ['home', 'away']
      : ['home', 'draw', 'away'];

    return (
      <div key={m.id} className={`match${locked ? ' locked' : ''}`}>
        <div className="meta">
          <span>
            {roundLabel(m)}
            {groupLabel(m.group_name) ? ` · ${groupLabel(m.group_name)}` : ''}
            {' — '}
            {formatKickoff(m.kickoff_at)}
          </span>
          <span className="meta-pills">
            <span className="pill worth" title="Puntos por acertar este partido">
              {worth(m)} {worth(m) === 1 ? 'pt' : 'pts'}
            </span>
            {doubled && (
              <span
                className="pill doble"
                style={{ marginLeft: 6 }}
                title="Comodín: este partido te cuenta doble"
              >
                ×2
              </span>
            )}
            {m.status === 'live' && (
              <span className="pill live" style={{ marginLeft: 6 }}>
                EN VIVO
              </span>
            )}
          </span>
        </div>

        <div className="matchup">
          <span
            className={`team${finished && m.winner === 'away' ? ' lost' : ''}`}
          >
            {teamWithFlag(m.home_team)}
          </span>
          <span className="vs">
            {locked ? `${m.home_score ?? '–'} : ${m.away_score ?? '–'}` : 'vs'}
          </span>
          <span
            className={`team team-right${finished && m.winner === 'home' ? ' lost' : ''}`}
          >
            {teamWithFlag(m.away_team)}
          </span>
        </div>

        {finished && isKnockout(m.stage) && m.winner && m.winner !== 'draw' && (
          <div className="advances muted">
            Avanza{' '}
            {teamWithFlag(m.winner === 'home' ? m.home_team : m.away_team)}
          </div>
        )}

        {hasResult && (
          <div className="result-line">
            <ResultBadge correct={myCorrect} pts={myPts} />
          </div>
        )}

        {locked ? (
          <details className="picks">
            <summary>
              Pronósticos de la liga{' '}
              <span className="hint">(hacé click para conocer todos los pronósticos)</span>
            </summary>
            {members.map((mem) => {
              const out = picksByMatch[m.id]?.[mem.id];
              const isMe = mem.id === user?.id;
              const correct =
                finished && out ? matchPointsForMatch(out, m) === 1 : null;
              return (
                <div key={mem.id} className={`pick-row${isMe ? ' me' : ''}`}>
                  <span>
                    {mem.display_name}
                    {isMe ? ' (vos)' : ''}
                  </span>
                  <span>
                    {out ? (
                      <>
                        {labelFull(m, out)}
                        {doublesByMatch[m.id]?.has(mem.id) && (
                          <span className="pill doble" style={{ marginLeft: 6 }}>
                            ×2
                          </span>
                        )}
                        {correct === true && ' ✓'}
                        {correct === false && ' ✗'}
                      </>
                    ) : (
                      <span className="muted">Sin pronóstico</span>
                    )}
                  </span>
                </div>
              );
            })}
          </details>
        ) : (
          <>
            <div
              className="outcomes"
              style={{
                gridTemplateColumns: `repeat(${options.length}, 1fr)`,
              }}
            >
              {options.map((o) => (
                <button
                  key={o}
                  className={
                    'outcome-btn' +
                    (myPred?.predicted_outcome === o ? ' active' : '')
                  }
                  disabled={savingId === m.id}
                  onClick={() => pick(m, o)}
                >
                  {label(m, o)}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {savingId === m.id
                ? 'Guardando…'
                : myPred
                  ? 'Pronóstico guardado — podés cambiarlo'
                  : isKnockout(m.stage)
                    ? 'Elegí quién avanza'
                    : 'Elegí un resultado'}
              {' · Cierra: '}
              {formatDeadline(lockAt(m, matches))} (ARG)
            </div>
            {canDouble && (
              <div className="doble-row">
                <button
                  className={'doble-btn' + (doubled ? ' active' : '')}
                  disabled={
                    savingId === m.id || (!doubled && stageRemaining === 0)
                  }
                  onClick={() => toggleDouble(m)}
                  title="Tu comodín duplica los puntos de este partido"
                >
                  {doubled ? '✓ Doble ×2 activado' : 'Usar comodín ×2'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  {doubled
                    ? 'Este partido te cuenta doble'
                    : stageRemaining > 0
                      ? `Te ${stageRemaining === 1 ? 'queda' : 'quedan'} ${stageRemaining} comodín${stageRemaining === 1 ? '' : 'es'} en esta fase`
                      : 'Sin comodines en esta fase'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">Cargando partidos…</p>
      </div>
    );
  }
  if (matches.length === 0) {
    return (
      <div className="card">
        <p className="muted">
          Todavía no hay partidos. Ejecutá la sincronización del fixture (ver
          README) para cargar el calendario del Mundial.
        </p>
      </div>
    );
  }

  // Group: phase -> matches; the group stage splits further into Fechas.
  const byStage = new Map<string, Match[]>();
  for (const m of matches) {
    const key = m.stage ?? '__none__';
    (byStage.get(key) ?? byStage.set(key, []).get(key)!).push(m);
  }
  const stageKeys = [...byStage.keys()].sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a);
    const ib = STAGE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Flatten into one tab per Fecha / phase, in calendar order.
  const sections: Section[] = [];
  for (const sk of stageKeys) {
    const stageMatches = byStage.get(sk)!;

    if (sk === 'GROUP_STAGE') {
      const byFecha = new Map<number, Match[]>();
      for (const m of stageMatches) {
        const f = m.matchday ?? -1;
        (byFecha.get(f) ?? byFecha.set(f, []).get(f)!).push(m);
      }
      const fechaKeys = [...byFecha.keys()].sort(
        (a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b),
      );
      for (const fk of fechaKeys) {
        sections.push({
          key: `gs-${fk}`,
          title:
            fk === -1
              ? 'Fase de grupos · Fecha a confirmar'
              : `Fase de grupos · Fecha ${fk}`,
          tabLabel: fk === -1 ? 'Fecha ?' : `Fecha ${fk}`,
          matches: byFecha.get(fk)!,
        });
      }
    } else {
      const title = sk === '__none__' ? 'Partidos' : stageLabel(sk);
      sections.push({ key: sk, title, tabLabel: title, matches: stageMatches });
    }
  }

  // Default tab: prefer the Fecha/fase that has a match being played today;
  // else the first section that still has a pronosticable match; if every
  // match is locked, land on the last (most recent) section instead.
  const sectionHasToday = (s: Section) =>
    s.matches.some((m) => isToday(m.kickoff_at));
  const sectionHasOpen = (s: Section) =>
    s.matches.some((m) => !isLocked(m, matches));
  const defaultSection =
    sections.find(sectionHasToday) ??
    sections.find(sectionHasOpen) ??
    sections.at(-1)!;
  const active =
    sections.find((s) => s.key === activeKey) ?? defaultSection;

  // Today's matches break out into their own wrapper at the top; the fecha
  // listing below still shows the full round (today's included).
  const todayMatches = active.matches.filter((m) => isToday(m.kickoff_at));

  return (
    <div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tabs subtabs" role="tablist">
        {sections.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={s.key === active.key}
            className={s.key === active.key ? 'active' : ''}
            onClick={() => setActiveKey(s.key)}
          >
            {s.tabLabel}
            {sectionHasOpen(s) && (
              <span className="dot" aria-hidden="true" title="Partidos abiertos" />
            )}
          </button>
        ))}
      </div>

      {todayMatches.length > 0 && (
        <section className="card today-card">
          <h3 className="phase-title">Hoy</h3>
          {todayMatches.map(renderMatch)}
        </section>
      )}

      <section className="card">
        <h3 className="phase-title">{active.title}</h3>
        {active.matches.map(renderMatch)}
      </section>
    </div>
  );
}
