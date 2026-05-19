import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TopBar } from '../components/TopBar';

export function ChangePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setOk(true);
      setPassword('');
      setConfirm('');
    }
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="card" style={{ maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>Cambiar contraseña</h2>

        {ok ? (
          <>
            <div
              className="card"
              style={{ margin: '0 0 14px', background: 'var(--bg-elev)' }}
            >
              ✓ Contraseña actualizada. Ya podés usar la nueva.
            </div>
            <button onClick={() => navigate('/')}>Volver al inicio</button>
          </>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            {error && <div className="error">{error}</div>}
            <div className="field">
              <label htmlFor="np">Nueva contraseña</label>
              <input
                id="np"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="cp">Repetir contraseña</label>
              <input
                id="cp"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
            <Link to="/" className="muted" style={{ fontSize: 14 }}>
              ← Volver
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
