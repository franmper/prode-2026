import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Match } from '../lib/types';
import { teamOptions, teamName, teamFlag } from '../lib/countries';
import { roundLabel, groupLabel, formatKickoff } from '../lib/scoring';

// Owner-only panel to create a fixture by hand when football-data.org hasn't
// published it yet. Writes via create_match (checks pool ownership). The match
// is stored with api_id NULL; the sync function adopts it (stamps the real
// api_id, matched by teams) once the API finally brings it.

const STAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'GROUP_STAGE', label: 'Fase de grupos' },
  { value: 'LAST_32', label: 'Dieciseisavos' },
  { value: 'LAST_16', label: 'Octavos' },
  { value: 'QUARTER_FINALS', label: 'Cuartos' },
  { value: 'SEMI_FINALS', label: 'Semifinal' },
  { value: 'THIRD_PLACE', label: 'Tercer puesto' },
  { value: 'FINAL', label: 'Final' },
];

// World Cup 2026: 48 teams in 12 groups (A–L), 3 fechas in the group stage.
const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const MATCHDAYS = ['1', '2', '3'];

export function CreateMatchPanel({ poolId }: Readonly<{ poolId: string }>) {
  const [stage, setStage] = useState('GROUP_STAGE');
  const [group, setGroup] = useState('A');
  const [matchday, setMatchday] = useState('1');
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [kickoff, setKickoff] = useState(''); // datetime-local, leído como hora ARG
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [manual, setManual] = useState<Match[]>([]);

  const isGroup = stage === 'GROUP_STAGE';

  const loadManual = useCallback(async () => {
    const { data } = await supabase
      .from('matches')
      .select('*')
      .is('api_id', null)
      .order('kickoff_at');
    setManual((data as Match[]) ?? []);
  }, []);

  useEffect(() => {
    loadManual();
  }, [loadManual]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setOk(false);

    if (!home || !away) {
      setError('Elegí los dos equipos.');
      return;
    }
    if (home === away) {
      setError('Los dos equipos no pueden ser el mismo.');
      return;
    }
    if (!kickoff) {
      setError('Indicá la fecha y hora del partido.');
      return;
    }

    // El datetime-local no lleva zona; lo interpretamos como hora de Argentina
    // (UTC-3, sin horario de verano) y lo mandamos en UTC.
    const kickoffIso = new Date(`${kickoff}:00-03:00`).toISOString();

    setSaving(true);
    const { error: err } = await supabase.rpc('create_match', {
      p_pool_id: poolId,
      p_stage: stage,
      p_group_name: isGroup ? `Group ${group}` : null,
      p_matchday: isGroup ? Number(matchday) : null,
      p_home_team: home,
      p_away_team: away,
      p_kickoff_at: kickoffIso,
    });
    if (err) {
      setError(err.message);
    } else {
      setOk(true);
      setHome('');
      setAway('');
      setKickoff('');
      await loadManual();
    }
    setSaving(false);
  }

  async function remove(m: Match) {
    if (
      !window.confirm(
        `¿Borrar ${teamName(m.home_team)} vs ${teamName(m.away_team)}? ` +
          'También se borran los pronósticos cargados para ese partido.',
      )
    ) {
      return;
    }
    setError('');
    const { error: err } = await supabase.rpc('delete_match', {
      p_pool_id: poolId,
      p_match_id: m.id,
    });
    if (err) setError(err.message);
    else await loadManual();
  }

  const flag = (raw: string | null | undefined) => {
    const src = teamFlag(raw);
    return src ? <img className="flag" src={src} alt="" aria-hidden="true" /> : null;
  };

  return (
    <div>
      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <form onSubmit={submit} className="create-match-form">
        <label className="cm-field">
          <span className="muted">Fase</span>
          <select value={stage} onChange={(ev) => setStage(ev.target.value)}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {isGroup && (
          <>
            <label className="cm-field">
              <span className="muted">Grupo</span>
              <select value={group} onChange={(ev) => setGroup(ev.target.value)}>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    Grupo {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="cm-field">
              <span className="muted">Fecha</span>
              <select value={matchday} onChange={(ev) => setMatchday(ev.target.value)}>
                {MATCHDAYS.map((d) => (
                  <option key={d} value={d}>
                    Fecha {d}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="cm-field">
          <span className="muted">Local</span>
          <select value={home} onChange={(ev) => setHome(ev.target.value)}>
            <option value="">Elegí equipo…</option>
            {teamOptions.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="cm-field">
          <span className="muted">Visitante</span>
          <select value={away} onChange={(ev) => setAway(ev.target.value)}>
            <option value="">Elegí equipo…</option>
            {teamOptions.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="cm-field">
          <span className="muted">Fecha y hora (ARG)</span>
          <input
            type="datetime-local"
            value={kickoff}
            onChange={(ev) => setKickoff(ev.target.value)}
          />
        </label>

        <div className="cm-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Creando…' : 'Crear partido'}
          </button>
          {ok && (
            <span className="muted" style={{ fontSize: 13 }}>
              ✓ Partido creado
            </span>
          )}
        </div>
      </form>

      <h4 style={{ margin: '24px 0 8px' }}>Partidos cargados a mano</h4>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Cuando la API publique el fixture, estos partidos se vinculan solos al
        sincronizar (no se duplican).
      </p>

      {manual.length === 0 ? (
        <p className="muted">Todavía no creaste ningún partido.</p>
      ) : (
        manual.map((m) => (
          <div key={m.id} className="cm-row">
            <div className="cm-row-main">
              <span className="cm-teams">
                {flag(m.home_team)} {teamName(m.home_team)}
                <span className="muted"> vs </span>
                {flag(m.away_team)} {teamName(m.away_team)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {roundLabel(m)}
                {m.group_name ? ` · ${groupLabel(m.group_name)}` : ''} —{' '}
                {formatKickoff(m.kickoff_at)}
              </span>
            </div>
            <button className="ghost" onClick={() => remove(m)}>
              Borrar
            </button>
          </div>
        ))
      )}
    </div>
  );
}
