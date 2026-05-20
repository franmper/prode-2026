import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Match, Prediction, Outcome } from '../lib/types';
import { teamName } from '../lib/countries';
import {
  matchPoints,
  isLocked,
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

interface Member {
  id: string;
  display_name: string;
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
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // User overrides per section. Missing key -> default-open if the section
  // still has at least one pronosticable match.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const setSectionOpen = (k: string, v: boolean) =>
    setOpenSections((s) => ({ ...s, [k]: v }));

  const load = useCallback(async () => {
    const [mRes, pRes, pmRes] = await Promise.all([
      supabase.from('matches').select('*').order('kickoff_at'),
      supabase.from('predictions').select('*'),
      supabase.from('pool_members').select('user_id').eq('pool_id', poolId),
    ]);
    if (mRes.error) setError(mRes.error.message);
    setMatches((mRes.data as Match[]) ?? []);

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
    for (const row of (pRes.data as Prediction[]) ?? []) {
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

  const label = (m: Match, o: Outcome) =>
    o === 'home'
      ? `Gana ${teamName(m.home_team)}`
      : o === 'away'
        ? `Gana ${teamName(m.away_team)}`
        : 'Empate';

  function renderMatch(m: Match) {
    const locked = isLocked(m, matches);
    const myPred = myPreds[m.id];
    const finished = m.status === 'finished';
    const myPts = finished && myPred
      ? matchPoints(myPred.predicted_outcome, m.home_score, m.away_score)
      : null;
    const options: Outcome[] = ['home', 'draw', 'away'];

    return (
      <div key={m.id} className={`match${locked ? ' locked' : ''}`}>
        <div className="meta">
          <span>
            {roundLabel(m)}
            {groupLabel(m.group_name) ? ` · ${groupLabel(m.group_name)}` : ''}
            {' — '}
            {formatKickoff(m.kickoff_at)}
          </span>
          <span>
            {m.status === 'live' && <span className="pill live">EN VIVO</span>}
            {finished && <span className="pill done">FINAL</span>}
            {myPts != null && (
              <span className="pill pts" style={{ marginLeft: 6 }}>
                +{myPts}
              </span>
            )}
          </span>
        </div>

        <div className="matchup">
          <span className="team">{teamName(m.home_team)}</span>
          <span className="vs">
            {locked ? `${m.home_score ?? '–'} : ${m.away_score ?? '–'}` : 'vs'}
          </span>
          <span className="team" style={{ textAlign: 'right' }}>
            {teamName(m.away_team)}
          </span>
        </div>

        {locked ? (
          <div className="picks">
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Pronósticos de la liga
            </div>
            {members.map((mem) => {
              const out = picksByMatch[m.id]?.[mem.id];
              const isMe = mem.id === user?.id;
              const correct =
                finished && out
                  ? matchPoints(out, m.home_score, m.away_score) === 1
                  : null;
              return (
                <div key={mem.id} className={`pick-row${isMe ? ' me' : ''}`}>
                  <span>
                    {mem.display_name}
                    {isMe ? ' (vos)' : ''}
                  </span>
                  <span>
                    {out ? (
                      <>
                        {label(m, out)}
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
          </div>
        ) : (
          <>
            <div className="outcomes">
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
                  : 'Elegí un resultado'}
              {' · Cierra: '}
              {formatDeadline(lockAt(m, matches))} (ARG)
            </div>
          </>
        )}
      </div>
    );
  }

  function renderSection(key: string, title: string, sectionMatches: Match[]) {
    const hasOpenMatch = sectionMatches.some((m) => !isLocked(m, matches));
    const open = openSections[key] ?? hasOpenMatch;
    return (
      <section key={key} className="card">
        <h3
          className={`phase-title toggle${open ? '' : ' closed'}`}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setSectionOpen(key, !open)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSectionOpen(key, !open);
            }
          }}
        >
          <span className="chev" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </h3>
        {open && sectionMatches.map(renderMatch)}
      </section>
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

  // Group: phase -> (group stage only) Fecha -> matches (kickoff-ordered).
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

  return (
    <div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {stageKeys.map((sk) => {
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
          return fechaKeys.map((fk) =>
            renderSection(
              `gs-${fk}`,
              fk === -1
                ? 'Fase de grupos · Fecha a confirmar'
                : `Fase de grupos · Fecha ${fk}`,
              byFecha.get(fk)!,
            ),
          );
        }

        return renderSection(
          sk,
          sk === '__none__' ? 'Partidos' : stageLabel(sk),
          stageMatches,
        );
      })}
    </div>
  );
}
