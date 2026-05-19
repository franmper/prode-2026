import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setBusy(true);
    try {
      await signUp(email.trim(), password, displayName);
      // La confirmación por email está desactivada: queda logueado al instante.
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
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
        <h2 style={{ margin: 0, fontSize: 18 }}>Crear cuenta</h2>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="name">Nombre para mostrar</label>
          <input
            id="name"
            type="text"
            maxLength={40}
            placeholder="Cómo vas a aparecer en la tabla"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="full" type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Registrarse'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
        ¿Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
      </p>
    </div>
  );
}
