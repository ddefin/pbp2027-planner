import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, forgotPassword } from "../api/auth";

// Le backend limite à 5 essais / 15 min par IP (voir src/routes/auth.ts) — un
// cooldown visible plus court évite surtout les doubles clics/soumissions
// involontaires, pas une attaque.
const RESEND_COOLDOWN_S = 30;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_S);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
    setBusy(true);
    try {
      await forgotPassword(email);
      setDone(true);
      startCooldown();
    } catch (err) {
      // Même en cas d'erreur, on ne distingue pas "compte inconnu" du reste — sauf
      // "non configuré", qui mérite un message clair plutôt qu'une fausse promesse
      // d'email envoyé.
      if (err instanceof ApiError && err.status === 503) {
        setNotConfigured(true);
      } else {
        setDone(true);
        startCooldown();
      }
    } finally {
      setBusy(false);
    }
  }

  if (notConfigured) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Non disponible</h1>
          <p className="hint">
            La réinitialisation par email n'est pas encore configurée sur ce serveur. Contacte l'administrateur du
            groupe pour récupérer l'accès à ton compte.
          </p>
          <Link to="/login" className="hint" style={{ textDecoration: "underline" }}>
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Vérifie tes emails</h1>
          <p className="hint">
            Si un compte existe avec cette adresse, un lien de réinitialisation valable 1 heure vient d'être envoyé.
          </p>
          <button
            type="button"
            className="ghost"
            style={{ marginTop: 16 }}
            disabled={cooldown > 0}
            onClick={async () => {
              setBusy(true);
              try {
                await forgotPassword(email);
              } catch {
                // le message générique ci-dessus reste valable même en cas d'erreur
              } finally {
                setBusy(false);
                startCooldown();
              }
            }}
          >
            {cooldown > 0 ? `Renvoyer le lien (${cooldown}s)` : busy ? "Envoi…" : "Renvoyer le lien"}
          </button>
          <p className="hint" style={{ marginTop: 16 }}>
            <Link to="/login">Retour à la connexion</Link>
          </p>
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
          <h1>Mot de passe oublié</h1>
          <p className="hint">Indique ton email, on t'envoie un lien pour choisir un nouveau mot de passe.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Envoi…" : "Envoyer le lien"}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 16 }}>
          <Link to="/login">Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
