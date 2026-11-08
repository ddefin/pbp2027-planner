import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, login, verifyMfa } from "../api/auth";
import { useAuth } from "../context/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  account_locked: "Compte verrouillé temporairement après trop d'échecs. Réessaie dans quelques minutes.",
  too_many_requests: "Trop de tentatives. Réessaie dans quelques minutes.",
  invalid_code: "Code incorrect.",
  expired: "Ce code a expiré, reconnecte-toi.",
  too_many_attempts: "Trop de tentatives sur ce code, reconnecte-toi.",
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
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.status === "mfa_required") {
        setChallengeToken(result.challengeToken);
      } else {
        await refresh();
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setBusy(true);
    try {
      await verifyMfa(challengeToken, code);
      await refresh();
      navigate("/", { replace: true });
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

        {!challengeToken ? (
          <form onSubmit={handlePasswordSubmit}>
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
        ) : (
          <form onSubmit={handleMfaSubmit}>
            <h1>Vérification en deux étapes</h1>
            {error && <div className="error-banner">{error}</div>}
            <div className="field">
              <label htmlFor="code">{useRecoveryCode ? "Code de récupération" : "Code à 6 chiffres"}</label>
              <input
                id="code"
                className={useRecoveryCode ? "" : "otp-input"}
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={useRecoveryCode ? "XXXX-XXXX" : "••••••"}
              />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Vérification…" : "Valider"}
            </button>
            <p className="hint" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setUseRecoveryCode(!useRecoveryCode);
                  setCode("");
                  setError(null);
                }}
              >
                {useRecoveryCode ? "Utiliser mon application d'authentification" : "Utiliser un code de récupération"}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
