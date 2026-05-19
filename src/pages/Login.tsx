import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="brand">
        Prode <span className="ball">⚽</span> 2026
      </div>
      <p className="tagline muted">Pronosticá el Mundial. Ganales a tus amigos.</p>

      <form className="card stack" onSubmit={onSubmit}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Iniciar sesión</h2>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="full" type="submit" disabled={busy}>
          {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
        ¿No tenés cuenta? <Link to="/signup">Creá una</Link>
      </p>
    </div>
  );
}
