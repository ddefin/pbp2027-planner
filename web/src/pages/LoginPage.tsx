import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, login } from "../api/auth";
import { useAuth } from "../context/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  account_locked: "Compte verrouillé temporairement après trop d'échecs. Réessaie dans quelques minutes.",
  account_suspended: "Ce compte est suspendu. Contacte l'administrateur du site.",
  too_many_requests: "Trop de tentatives. Réessaie dans quelques minutes.",
  invalid_input: "Formulaire invalide.",
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? "Une erreur est survenue.";
  return "Une erreur est survenue.";
}

export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      await refresh();
      // Connexion normale : accueil. On ne revient sur la page demandée que dans deux cas
      // voulus : l'espace d'administration (/admin…) et le retour depuis Strava (?strava=…).
      // Chemin interne uniquement (jamais un autre site).
      const next = new URLSearchParams(window.location.search).get("next");
      const internal = next !== null && next.startsWith("/") && !next.startsWith("//");
      const wanted = internal && (/^\/admin(\/|$|\?|#)/.test(next!) || (/^\/profil\b/.test(next!) && next!.includes("strava=")));
      navigate(wanted ? next! : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          PBP<span>2027</span>
        </div>

        <form onSubmit={handleSubmit}>
          <h1>Connexion</h1>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
          <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
            <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
