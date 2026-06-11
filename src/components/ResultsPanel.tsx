import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Match } from '../lib/types';
import { teamName, teamFlag } from '../lib/countries';
import { isKnockout, stageLabel, roundLabel, formatKickoff } from '../lib/scoring';

// Owner-only panel to complete match results by hand (the free football API
// marks matches FINISHED without a score). Writes via set_match_result, which
// checks pool ownership; the sync function then leaves complete matches alone.
export function ResultsPanel({ poolId }: Readonly<{ poolId: string }>) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [okId, setOkId] = useState<string | null>(null);
  // Only show matches already kicked off (the ones that need a result).
  const [showAll, setShowAll] = useState(false);
  // Local edits per match: { home, away, winner }.
  const [draft, setDraft] = useState<
    Record<string, { home: string; away: string; winner: 'home' | 'away' | '' }>
  >({});

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('matches')
      .select('*')
      .order('kickoff_at');
    if (e) setError(e.message);
    setMatches((data as Match[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function fieldFor(m: Match) {
    return (
      draft[m.id] ?? {
        home: m.home_score?.toString() ?? '',
        away: m.away_score?.toString() ?? '',
        winner: (m.winner === 'home' || m.winner === 'away' ? m.winner : '') as
          | 'home'
          | 'away'
          | '',
      }
    );
  }

  function setField(
    m: Match,
    patch: Partial<{ home: string; away: string; winner: 'home' | 'away' | '' }>,
  ) {
    setDraft((d) => ({ ...d, [m.id]: { ...fieldFor(m), ...patch } }));
  }

  async function save(m: Match) {
    const f = fieldFor(m);
    setSavingId(m.id);
    setError('');
    setOkId(null);

    const ko = isKnockout(m.stage);
    const home = f.home === '' ? null : Number(f.home);
    const away = f.away === '' ? null : Number(f.away);

    if (!ko && (home == null || away == null)) {
      setError('Cargá ambos marcadores.');
      setSavingId(null);
      return;
    }
    if (ko && f.winner === '') {
      setError('Elegí quién avanza.');
      setSavingId(null);
      return;
    }

    const { error: e } = await supabase.rpc('set_match_result', {
      p_pool_id: poolId,
      p_match_id: m.id,
      p_home_score: home,
      p_away_score: away,
      p_winner: ko ? f.winner : null,
    });
    if (e) {
      setError(e.message);
    } else {
      setOkId(m.id);
      await load();
    }
    setSavingId(null);
  }

  const flag = (raw: string | null | undefined) => {
    const src = teamFlag(raw);
    return src ? <img className="flag" src={src} alt="" aria-hidden="true" /> : null;
  };

  if (loading) return <p className="muted">Cargando partidos…</p>;

  const now = Date.now();
  const visible = matches.filter(
    (m) => showAll || new Date(m.kickoff_at).getTime() <= now,
  );

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <label
        className="muted"
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}
      >
        <input
          type="checkbox"
          checked={showAll}
          onChange={(ev) => setShowAll(ev.target.checked)}
        />
        Mostrar todos los partidos (no solo los ya jugados)
      </label>

      {visible.length === 0 && (
        <p className="muted">Todavía no hay partidos jugados para cargar.</p>
      )}

      {visible.map((m) => {
        const f = fieldFor(m);
        const ko = isKnockout(m.stage);
        const done =
          m.status === 'finished' &&
          (ko ? m.winner != null : m.home_score != null);
        return (
          <div key={m.id} className="result-edit">
            <div className="meta">
              <span>
                {roundLabel(m)}
                {m.stage && m.stage !== 'GROUP_STAGE'
                  ? ''
                  : m.group_name
                    ? ` · ${m.group_name}`
                    : ''}
                {' — '}
                {formatKickoff(m.kickoff_at)}
              </span>
              <span>
                {done ? (
                  <span className="pill done">CARGADO</span>
                ) : (
                  <span className="pill worth">PENDIENTE</span>
                )}
              </span>
            </div>

            <div className="result-edit-row">
              <span className="re-team">
                {flag(m.home_team)} {teamName(m.home_team)}
              </span>

              <input
                className="re-score"
                type="number"
                min={0}
                inputMode="numeric"
                value={f.home}
                onChange={(ev) => setField(m, { home: ev.target.value })}
              />
              <span className="re-sep">:</span>
              <input
                className="re-score"
                type="number"
                min={0}
                inputMode="numeric"
                value={f.away}
                onChange={(ev) => setField(m, { away: ev.target.value })}
              />

              <span className="re-team re-team-right">
                {teamName(m.away_team)} {flag(m.away_team)}
              </span>
            </div>

            {ko && (
              <div className="re-advances">
                <span className="muted" style={{ fontSize: 12 }}>
                  Avanza:
                </span>
                <button
                  className={'re-pick' + (f.winner === 'home' ? ' active' : '')}
                  onClick={() => setField(m, { winner: 'home' })}
                >
                  {flag(m.home_team)} {teamName(m.home_team)}
                </button>
                <button
                  className={'re-pick' + (f.winner === 'away' ? ' active' : '')}
                  onClick={() => setField(m, { winner: 'away' })}
                >
                  {flag(m.away_team)} {teamName(m.away_team)}
                </button>
              </div>
            )}

            <div className="re-actions">
              <button
                className="secondary"
                disabled={savingId === m.id}
                onClick={() => save(m)}
              >
                {savingId === m.id ? 'Guardando…' : 'Guardar resultado'}
              </button>
              {okId === m.id && (
                <span className="muted" style={{ fontSize: 12 }}>
                  ✓ Guardado
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
