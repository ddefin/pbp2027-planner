import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, resetPassword } from "../api/auth";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired_token: "Ce lien a expiré ou a déjà été utilisé — redemande un nouveau lien.",
  too_many_requests: "Trop de tentatives. Réessaie dans quelques minutes.",
  invalid_input: "Le mot de passe doit faire au moins 10 caractères.",
};

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_MESSAGES[err.code] ?? "Une erreur est survenue.") : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Lien invalide</h1>
          <p className="hint">Ce lien de réinitialisation est incomplet. Redemande-en un nouveau.</p>
          <Link to="/mot-de-passe-oublie" className="hint" style={{ textDecoration: "underline" }}>
            Demander un nouveau lien
          </Link>
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
          <h1>Nouveau mot de passe</h1>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="password">Nouveau mot de passe (10 caractères min.)</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirmer le mot de passe</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Changer le mot de passe"}
          </button>
        </form>
      </div>
    </div>
  );
}
