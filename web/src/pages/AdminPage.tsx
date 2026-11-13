import { useState, type FormEvent } from "react";
import { lookupAccount, type AdminLookup } from "../api/admin";

// Libellés lisibles pour le journal (voir src/routes/auth.ts et src/lib/authEvents.ts).
const KIND: Record<string, { label: string; tone: "ok" | "warn" | "error" | "info" }> = {
  reset_requested: { label: "Demande de réinitialisation reçue", tone: "info" },
  reset_no_account: { label: "Demande pour une adresse sans compte (rien n'est envoyé)", tone: "warn" },
  mail_sent: { label: "E-mail de réinitialisation envoyé au serveur mail", tone: "ok" },
  mail_failed: { label: "E-mail NON envoyé (voir la cause)", tone: "error" },
  reset_ok: { label: "Mot de passe réinitialisé", tone: "ok" },
  reset_token_invalid: { label: "Lien de réinitialisation refusé (expiré ou déjà utilisé)", tone: "warn" },
  login_locked: { label: "Compte verrouillé après plusieurs erreurs de mot de passe", tone: "error" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

export function AdminPage() {
  const [email, setEmail] = useState("");
  const [data, setData] = useState<AdminLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setData(await lookupAccount(email.trim().toLowerCase()));
    } catch {
      setError("Recherche impossible pour le moment.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  const lastMail = data?.events.find((ev) => ev.kind === "mail_sent" || ev.kind === "mail_failed");

  return (
    <div className="wrap">
      <section className="panel">
        <h2>Administration</h2>
        <p className="hint">
          Diagnostic d'un compte : pourquoi une réinitialisation de mot de passe n'arrive pas, s'il est verrouillé, et ce que le serveur a fait. Aucun mot de passe ni lien n'est affiché.
        </p>
        <form onSubmit={search} className="live-inline" style={{ marginBottom: 0 }}>
          <input type="email" className="rb-input" placeholder="adresse e-mail du randonneur" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Adresse e-mail" style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" className="primary" disabled={busy} style={{ width: "auto" }}>
            {busy ? "Recherche…" : "Rechercher"}
          </button>
        </form>
        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      {data && (
        <>
          <section className="panel">
            <h3 style={{ marginTop: 0 }}>{data.exists ? "Compte trouvé" : "Aucun compte pour cette adresse"}</h3>
            {data.account ? (
              <dl className="sv-trio" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 16px", margin: 0 }}>
                <div><dt className="hint" style={{ margin: 0 }}>Prénom</dt><dd style={{ margin: 0 }}>{data.account.prenom}</dd></div>
                <div><dt className="hint" style={{ margin: 0 }}>Adresse</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{data.account.email}</dd></div>
                <div><dt className="hint" style={{ margin: 0 }}>Inscrit le</dt><dd style={{ margin: 0 }}>{fmt(data.account.createdAt)}</dd></div>
                <div><dt className="hint" style={{ margin: 0 }}>Dernière activité</dt><dd style={{ margin: 0 }}>{fmt(data.account.lastSeenAt)}</dd></div>
                <div><dt className="hint" style={{ margin: 0 }}>Liens de réinitialisation valides</dt><dd style={{ margin: 0 }}>{data.account.activeResetLinks}</dd></div>
                <div><dt className="hint" style={{ margin: 0 }}>Mots de passe erronés (en cours)</dt><dd style={{ margin: 0 }}>{data.account.failedLoginAttempts}</dd></div>
                <div>
                  <dt className="hint" style={{ margin: 0 }}>État</dt>
                  <dd style={{ margin: 0 }} className={data.account.locked ? "lvl-text-late" : "lvl-text-ok"}>
                    {data.account.locked ? `Verrouillé jusqu'à ${fmt(data.account.lockedUntil)}` : "Actif"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="hint" style={{ margin: 0 }}>Aucun compte n'existe avec cette adresse : le randonneur doit vérifier l'orthographe ou s'inscrire. Pour des raisons de sécurité, le site répond « vérifie ta boîte mail » dans tous les cas.</p>
            )}
          </section>

          <section className="panel">
            <h3 style={{ marginTop: 0 }}>Ce que le serveur a fait</h3>
            {!lastMail && data.events.some((ev) => ev.kind === "reset_requested") && (
              <p className="sv-lvl-attention">⚠️ Une demande est arrivée sans envoi enregistré : le serveur n'a pas fini d'envoyer le mail, ou il a planté avant.</p>
            )}
            {lastMail?.kind === "mail_failed" && (
              <div className="error-banner">
                Dernier envoi <strong>échoué</strong> : {lastMail.detail ?? "cause inconnue"}
              </div>
            )}
            {data.events.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>Aucun événement enregistré pour cette adresse (60 jours conservés).</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {data.events.map((ev, i) => {
                  const k = KIND[ev.kind] ?? { label: ev.kind, tone: "info" as const };
                  return (
                    <li key={`${ev.at}-${i}`} style={{ borderLeft: "4px solid var(--line)", paddingLeft: 10 }} className={`sv-border-${k.tone === "ok" ? "ok" : k.tone === "error" ? "alerte" : k.tone === "warn" ? "attention" : "info"}`}>
                      <div style={{ fontSize: 13, color: "var(--fg-muted)" }} className="tabular">{fmt(ev.at)}</div>
                      <div>{k.label}</div>
                      {ev.detail && <div className="hint" style={{ margin: 0, overflowWrap: "anywhere" }}>{ev.detail}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3 style={{ marginTop: 0 }}>Configuration du mail</h3>
            {data.mail.configured ? (
              <p style={{ margin: 0 }}>
                ✓ Serveur <code>{data.mail.host}:{data.mail.port}</code>, expéditeur <code>{data.mail.from}</code>. Lien envoyé : <code>{data.mail.publicUrl ?? "adresse déduite de la requête"}</code>
              </p>
            ) : (
              <p className="sv-lvl-alerte" style={{ margin: 0 }}>⚠️ Aucun serveur mail configuré (SMTP_HOST absent de .env.production) : aucune réinitialisation ne peut partir.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
