import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(email, password);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Compte créé</h1>
          <p className="hint">Tu peux maintenant te connecter, puis activer la double authentification depuis les paramètres de sécurité.</p>
          <button className="primary" onClick={() => navigate("/login")}>
            Aller à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          PBP<span>2027</span>
        </div>
        <form onSubmit={handleSubmit}>
          <h1>Créer un compte</h1>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe (10 caractères min.)</label>
            <input
              id="password"
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Création…" : "Créer le compte"}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 16 }}>
          Déjà un compte ? <Link to="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
