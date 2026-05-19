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

// Phase display order; unknown stages get appended after these.
const STAGE_ORDER = [
  'GROUP_STAGE',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
];

export function MatchList() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('matches').select('*').order('kickoff_at'),
      supabase.from('predictions').select('*'),
    ]);
    if (m.error) setError(m.error.message);
    setMatches((m.data as Match[]) ?? []);
    const map: Record<string, Prediction> = {};
    for (const row of (p.data as Prediction[]) ?? []) map[row.match_id] = row;
    setPreds(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Refresca en vivo cuando cambian los resultados (los escribe la Edge Function).
    const channel = supabase
      .channel('matches-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

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
    const pred = preds[m.id];
    const finished = m.status === 'finished';
    const pts = finished && pred
      ? matchPoints(pred.predicted_outcome, m.home_score, m.away_score)
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
            {pts != null && (
              <span className="pill pts" style={{ marginLeft: 6 }}>
                +{pts}
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
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {pred ? (
              <>
                Tu pronóstico: <strong>{label(m, pred.predicted_outcome)}</strong>
                {finished && (pts ? ' — ¡Acertaste! ✓' : ' — No acertaste ✗')}
              </>
            ) : (
              'No pronosticaste este partido'
            )}
          </div>
        ) : (
          <>
            <div className="outcomes">
              {options.map((o) => (
                <button
                  key={o}
                  className={
                    'outcome-btn' +
                    (pred?.predicted_outcome === o ? ' active' : '')
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
                : pred
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

  // Group: phase -> (group stage only) grupo -> matches (kept kickoff-ordered).
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
          // Subgroup by Fecha (matchday). -1 = matchday not synced yet.
          const byFecha = new Map<number, Match[]>();
          for (const m of stageMatches) {
            const f = m.matchday ?? -1;
            (byFecha.get(f) ?? byFecha.set(f, []).get(f)!).push(m);
          }
          const fechaKeys = [...byFecha.keys()].sort(
            (a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b),
          );
          return fechaKeys.map((fk) => (
            <section key={`gs-${fk}`} className="card">
              <h3 className="phase-title">
                {fk === -1
                  ? 'Fase de grupos · Fecha a confirmar'
                  : `Fase de grupos · Fecha ${fk}`}
              </h3>
              {byFecha.get(fk)!.map(renderMatch)}
            </section>
          ));
        }

        return (
          <section key={sk} className="card">
            <h3 className="phase-title">
              {sk === '__none__' ? 'Partidos' : stageLabel(sk)}
            </h3>
            {stageMatches.map(renderMatch)}
          </section>
        );
      })}
    </div>
  );
}
