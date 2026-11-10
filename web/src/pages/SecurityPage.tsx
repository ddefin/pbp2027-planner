import { useState } from "react";
import { revokeOtherSessions } from "../api/auth";

export function SecurityPage() {
  const [busy, setBusy] = useState(false);

  async function handleRevokeOthers() {
    setBusy(true);
    try {
      await revokeOtherSessions();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
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
