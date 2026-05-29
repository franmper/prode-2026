import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { stageLabel } from '../lib/scoring';

// Stages shown in the points editor, in tournament order.
const STAGES = [
  'GROUP_STAGE',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
];

// Knockout phases where the comodín ×2 can be used.
const DOBLE_STAGES = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS'];

type Doble = { enabled: boolean; count: number };

export function ScoringPanel({ poolId }: Readonly<{ poolId: string }>) {
  const [points, setPoints] = useState<Record<string, number>>({});
  const [doubles, setDoubles] = useState<Record<string, Doble>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const load = useCallback(async () => {
    const [spRes, sdRes] = await Promise.all([
      supabase
        .from('pool_stage_points')
        .select('stage, points')
        .eq('pool_id', poolId),
      supabase
        .from('pool_stage_doubles')
        .select('stage, enabled, count')
        .eq('pool_id', poolId),
    ]);
    if (spRes.error) setError(spRes.error.message);

    const nextP: Record<string, number> = {};
    for (const s of STAGES) nextP[s] = 1;
    for (const r of (spRes.data as { stage: string; points: number }[]) ?? []) {
      nextP[r.stage] = r.points;
    }
    setPoints(nextP);

    const nextD: Record<string, Doble> = {};
    for (const s of DOBLE_STAGES) nextD[s] = { enabled: true, count: 1 };
    for (const r of (sdRes.data as {
      stage: string;
      enabled: boolean;
      count: number;
    }[]) ?? []) {
      nextD[r.stage] = { enabled: r.enabled, count: r.count };
    }
    setDoubles(nextD);

    setLoading(false);
  }, [poolId]);

  useEffect(() => {
    load();
  }, [load]);

  function setStage(stage: string, raw: string) {
    const n = Math.max(0, Math.min(100, Math.floor(Number(raw) || 0)));
    setPoints((p) => ({ ...p, [stage]: n }));
    setSavedMsg('');
  }

  function setDobleEnabled(stage: string, enabled: boolean) {
    setDoubles((d) => ({ ...d, [stage]: { ...d[stage], enabled } }));
    setSavedMsg('');
  }

  function setDobleCount(stage: string, raw: string) {
    const n = Math.max(0, Math.min(20, Math.floor(Number(raw) || 0)));
    setDoubles((d) => ({ ...d, [stage]: { ...d[stage], count: n } }));
    setSavedMsg('');
  }

  async function save() {
    setSaving(true);
    setError('');
    setSavedMsg('');
    const pointRows = STAGES.map((stage) => ({
      pool_id: poolId,
      stage,
      points: points[stage] ?? 1,
    }));
    const dobleRows = DOBLE_STAGES.map((stage) => ({
      pool_id: poolId,
      stage,
      enabled: doubles[stage]?.enabled ?? true,
      count: doubles[stage]?.count ?? 1,
    }));
    const [spRes, sdRes] = await Promise.all([
      supabase
        .from('pool_stage_points')
        .upsert(pointRows, { onConflict: 'pool_id,stage' }),
      supabase
        .from('pool_stage_doubles')
        .upsert(dobleRows, { onConflict: 'pool_id,stage' }),
    ]);
    const err = spRes.error ?? sdRes.error;
    if (err) setError(err.message);
    else setSavedMsg('Puntajes guardados.');
    setSaving(false);
  }

  if (loading) return <p className="muted">Cargando puntajes…</p>;

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Cuántos puntos vale acertar el resultado de un partido en cada fase. Las
        fases finales pueden valer más para que la liga no se defina solo en la
        fase de grupos.
      </p>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="stage-points">
        {STAGES.map((stage) => (
          <label key={stage} className="stage-points-row">
            <span>{stageLabel(stage)}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={points[stage] ?? 1}
              onChange={(e) => setStage(stage, e.target.value)}
            />
          </label>
        ))}
      </div>

      <h4 style={{ margin: '24px 0 4px' }}>Comodín ×2</h4>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Cada jugador puede marcar partidos de eliminación directa para que
        cuenten el doble. Configurá cada fase por separado: si está habilitada y
        cuántos comodines tiene cada jugador en esa fase. Se puede cambiar hasta
        que el partido se cierra.
      </p>
      <div className="doble-config">
        <div className="doble-config-head">
          <span>Fase</span>
          <span>Activo</span>
          <span>Por jugador</span>
        </div>
        {DOBLE_STAGES.map((stage) => {
          const d = doubles[stage] ?? { enabled: true, count: 1 };
          return (
            <div key={stage} className="doble-config-row">
              <span>{stageLabel(stage)}</span>
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => setDobleEnabled(stage, e.target.checked)}
              />
              <input
                type="number"
                min={0}
                max={20}
                disabled={!d.enabled}
                value={d.count}
                onChange={(e) => setDobleCount(stage, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
        <button onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar puntajes'}
        </button>
        {savedMsg && (
          <span className="muted" style={{ fontSize: 13 }}>
            {savedMsg}
          </span>
        )}
      </div>
    </div>
  );
}
