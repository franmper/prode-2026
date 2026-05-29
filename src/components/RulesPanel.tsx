import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { stageLabel } from '../lib/scoring';

const STAGES = [
  'GROUP_STAGE',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
];

const DOBLE_STAGES = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS'];

type Doble = { enabled: boolean; count: number };

export function RulesPanel({ poolId }: Readonly<{ poolId: string }>) {
  const [points, setPoints] = useState<Record<string, number>>({});
  const [doubles, setDoubles] = useState<Record<string, Doble>>({});
  const [loading, setLoading] = useState(true);

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
    const p: Record<string, number> = {};
    for (const s of STAGES) p[s] = 1;
    for (const r of (spRes.data as { stage: string; points: number }[]) ?? []) {
      p[r.stage] = r.points;
    }
    setPoints(p);

    const d: Record<string, Doble> = {};
    for (const r of (sdRes.data as {
      stage: string;
      enabled: boolean;
      count: number;
    }[]) ?? []) {
      d[r.stage] = { enabled: r.enabled, count: r.count };
    }
    setDoubles(d);
    setLoading(false);
  }, [poolId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="muted">Cargando reglas…</p>;

  const anyDoble = DOBLE_STAGES.some(
    (s) => doubles[s]?.enabled && (doubles[s]?.count ?? 0) > 0,
  );

  return (
    <div className="rules">
      <h3 style={{ marginTop: 0 }}>Cómo se juega</h3>

      <section className="rule-block">
        <h4>1 · El pronóstico</h4>
        <p>
          <strong>Fase de grupos:</strong> elegís uno de tres resultados —{' '}
          <strong>gana el local</strong>, <strong>empate</strong> o{' '}
          <strong>gana el visitante</strong>. No se pronostica el marcador
          exacto, solo el 1-X-2.
        </p>
        <p>
          <strong>Eliminación directa:</strong> elegís{' '}
          <strong>quién avanza</strong> de ronda (no hay empate). Cuenta el
          equipo que clasifica, incluyendo alargue y penales: si el partido
          termina 1-1 y se define por penales, acertás si elegiste al que pasa.
        </p>
      </section>

      <section className="rule-block">
        <h4>2 · Cuándo cierra</h4>
        <ul>
          <li>
            <strong>Fase de grupos:</strong> todos los partidos de una Fecha se
            cierran juntos, a las <strong>23:59 (ARG)</strong> del día anterior
            al primer partido de esa Fecha.
          </li>
          <li>
            <strong>Eliminación directa:</strong> cada partido cierra a las
            23:59 (ARG) del día anterior a ese partido.
          </li>
        </ul>
        <p className="muted" style={{ fontSize: 13 }}>
          Podés cambiar tu pronóstico todas las veces que quieras hasta que
          cierra. Después queda fijo.
        </p>
      </section>

      <section className="rule-block">
        <h4>3 · Puntos por acertar</h4>
        <p>
          Acertar el resultado suma puntos según la fase. Las fases finales
          valen más, así una buena fase de grupos no define todo el campeonato.
        </p>
        <table className="board rules-table">
          <thead>
            <tr>
              <th>Fase</th>
              <th className="num">Puntos por acierto</th>
            </tr>
          </thead>
          <tbody>
            {STAGES.map((s) => (
              <tr key={s}>
                <td>{stageLabel(s)}</td>
                <td className="num">
                  <strong>{points[s] ?? 1}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 13 }}>
          Errar el resultado suma 0. Estos valores los define el dueño de la
          liga, así que pueden variar entre ligas.
        </p>
      </section>

      <section className="rule-block">
        <h4>4 · Comodín ×2</h4>
        {anyDoble ? (
          <>
            <p>
              En la eliminación directa podés marcar algunos partidos como{' '}
              <strong>×2</strong>: si acertás, ese partido te suma el{' '}
              <strong>doble</strong> de puntos. Lo elegís vos y podés cambiarlo
              hasta que el partido cierra. Cada fase tiene su propio cupo:
            </p>
            <table className="board rules-table">
              <thead>
                <tr>
                  <th>Fase</th>
                  <th className="num">Comodines por jugador</th>
                </tr>
              </thead>
              <tbody>
                {DOBLE_STAGES.map((s) => {
                  const d = doubles[s];
                  const n = d?.enabled ? (d?.count ?? 0) : 0;
                  return (
                    <tr key={s}>
                      <td>{stageLabel(s)}</td>
                      <td className="num">
                        {n > 0 ? <strong>{n}</strong> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 13 }}>
              El cupo es por fase: usar un comodín en Octavos no te quita los de
              Cuartos.
            </p>
          </>
        ) : (
          <p className="muted">
            En esta liga el comodín ×2 está desactivado.
          </p>
        )}
      </section>

      <section className="rule-block">
        <h4>5 · Pronósticos de los demás</h4>
        <p>
          Los pronósticos (y los ×2) de los demás quedan ocultos hasta que el
          partido cierra. Después se revelan, así nadie puede copiar antes de
          tiempo.
        </p>
      </section>

      <section className="rule-block">
        <h4>6 · Tabla de posiciones</h4>
        <p>
          Gana quien suma más puntos. Si hay empate, se ordena por cantidad de
          aciertos y, si sigue el empate, por orden alfabético.
        </p>
      </section>
    </div>
  );
}
