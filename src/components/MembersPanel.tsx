import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Member {
  id: string;
  display_name: string;
}

export function MembersPanel({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<string, { password?: string; error?: string }>
  >({});

  const load = useCallback(async () => {
    const { data: pm } = await supabase
      .from('pool_members')
      .select('user_id')
      .eq('pool_id', poolId);
    const ids = (pm ?? []).map((r: { user_id: string }) => r.user_id);
    if (ids.length === 0) {
      setMembers([]);
      setLoading(false);
      return;
    }
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', ids);
    setMembers((profs as Member[]) ?? []);
    setLoading(false);
  }, [poolId]);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(m: Member) {
    if (busyId) return;
    setBusyId(m.id);
    setResults((r) => ({ ...r, [m.id]: {} }));
    const { data, error } = await supabase.functions.invoke(
      'reset-member-password',
      { body: { pool_id: poolId, target_user_id: m.id } },
    );
    if (error) {
      let detail = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) detail = body.error;
      } catch {
        /* keep generic message */
      }
      setResults((r) => ({ ...r, [m.id]: { error: detail } }));
    } else {
      setResults((r) => ({ ...r, [m.id]: { password: data?.password } }));
    }
    setBusyId(null);
  }

  if (loading) return <p className="muted">Cargando miembros…</p>;
  if (members.length === 0)
    return <p className="muted">Todavía no hay miembros.</p>;

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Reseteás la contraseña de un miembro y le pasás la temporal por privado.
        Conviene que la cambie después de entrar.
      </p>
      {members.map((m) => {
        const res = results[m.id];
        return (
          <div
            key={m.id}
            className="pool-item"
            style={{ display: 'block' }}
          >
            <div className="spread">
              <strong>
                {m.display_name}
                {m.id === user?.id ? ' (vos)' : ''}
              </strong>
              <button
                className="secondary"
                disabled={busyId === m.id}
                onClick={() => reset(m)}
              >
                {busyId === m.id ? 'Reseteando…' : 'Resetear contraseña'}
              </button>
            </div>
            {res?.password && (
              <div className="card" style={{ margin: '10px 0 0' }}>
                Contraseña temporal de <strong>{m.display_name}</strong>:{' '}
                <span className="code" style={{ color: 'var(--accent)' }}>
                  {res.password}
                </span>
                <button
                  className="ghost"
                  style={{ marginLeft: 8 }}
                  onClick={() => navigator.clipboard.writeText(res.password!)}
                >
                  Copiar
                </button>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Deja de funcionar cuando el miembro la cambie.
                </div>
              </div>
            )}
            {res?.error && (
              <div className="error" style={{ marginTop: 10 }}>
                {res.error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
