import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, forgotPassword } from "../api/auth";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
      setDone(true);
    } catch (err) {
      // Même en cas d'erreur, on ne distingue pas "compte inconnu" du reste — sauf
      // "non configuré", qui mérite un message clair plutôt qu'une fausse promesse
      // d'email envoyé.
      if (err instanceof ApiError && err.status === 503) setNotConfigured(true);
      else setDone(true);
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
          <Link to="/login" className="hint" style={{ textDecoration: "underline" }}>
            Retour à la connexion
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
