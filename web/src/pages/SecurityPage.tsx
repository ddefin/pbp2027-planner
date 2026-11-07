import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ApiError, disableMfa, enableMfa, revokeOtherSessions, setupMfa } from "../api/auth";
import { useAuth } from "../context/AuthContext";

type SetupState = { secret: string; otpauthUri: string } | null;

export function SecurityPage() {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<SetupState>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (setup && qrRef.current) {
      QRCode.toCanvas(qrRef.current, setup.otpauthUri, { width: 200 }).catch(() => undefined);
    }
  }, [setup]);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const res = await setupMfa();
      setSetup(res);
    } catch {
      setError("Impossible de démarrer l'activation de la MFA.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await enableMfa(code);
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "invalid_code" ? "Code incorrect." : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!confirm("Désactiver la double authentification sur ce compte ?")) return;
    setBusy(true);
    try {
      await disableMfa();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeOthers() {
    setBusy(true);
    try {
      await revokeOtherSessions();
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="wrap">
        <section className="panel">
          <h2>Codes de récupération</h2>
          <p className="hint">
            Enregistre-les dans un endroit sûr : ils ne seront plus jamais affichés. Chacun ne peut être utilisé qu'une
            seule fois pour te connecter si tu perds l'accès à ton application d'authentification.
          </p>
          <div className="recovery-grid">
            {recoveryCodes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
          <button className="primary" onClick={() => setRecoveryCodes(null)}>
            J'ai enregistré mes codes
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="wrap">
      <section className="panel">
        <h2>Double authentification (MFA)</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="security-row">
          <div>
            <div className="t">Authentification à deux facteurs (TOTP)</div>
            <div className="d">
              <span className={`badge-mfa ${user?.mfaEnabled ? "on" : "off"}`}>
                {user?.mfaEnabled ? "Activée" : "Désactivée"}
              </span>
            </div>
          </div>
          {user?.mfaEnabled ? (
            <button className="ghost" onClick={handleDisable} disabled={busy}>
              Désactiver
            </button>
          ) : (
            <button className="ghost" onClick={startSetup} disabled={busy}>
              Activer
            </button>
          )}
        </div>

        {setup && (
          <form onSubmit={handleEnable} style={{ marginTop: 16 }}>
            <p className="hint">
              Scanne ce QR code avec ton application d'authentification (Google Authenticator, Authy…), puis saisis le
              code généré pour confirmer.
            </p>
            <div className="qr-box">
              <canvas ref={qrRef} />
            </div>
            <p className="hint tabular">Secret : {setup.secret}</p>
            <div className="field">
              <label htmlFor="enable-code">Code de confirmation</label>
              <input
                id="enable-code"
                className="otp-input"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="••••••"
              />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              Confirmer et activer
            </button>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Sessions</h2>
        <div className="security-row">
          <div>
            <div className="t">Déconnecter les autres sessions</div>
            <div className="d">Termine toutes les sessions actives sauf celle-ci.</div>
          </div>
          <button className="ghost" onClick={handleRevokeOthers} disabled={busy}>
            Déconnecter
          </button>
        </div>
      </section>
    </div>
  );
}
