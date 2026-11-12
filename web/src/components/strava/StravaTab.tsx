import { useCallback, useEffect, useState } from "react";
import { disconnectStrava, getStravaConnectUrl, getStravaDashboard, getStravaStatus, syncStrava, type Dashboard, type StravaStatus } from "../../api/strava";
import { Disclosure } from "../Disclosure";
import { AiConnectors, CoachSettings } from "./AiConnectors";
import { CoachCard } from "./CoachCard";
import { AcwrGauge, IntensityBar, TrendChart } from "./StravaCharts";

const fmt = (n: number, d = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

function ago(iso: string | null): string {
  if (!iso) return "jamais";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.floor(min / 60)} h`;
  return `il y a ${Math.floor(min / 1440)} j`;
}

// Bouton « Connect with Strava » : orange Strava #FC4C02, texte blanc. Pour l'habillage
// officiel exact, déposer le fichier fourni par Strava (strava.com/developers/brand) dans
// web/public et remplacer ce bouton par l'image.
function ConnectButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button type="button" className="sv-connect" onClick={onClick} disabled={busy}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d="M15.4 17.9 13.7 14.6h-2.5L15.4 23l4.1-8.4h-2.4M10.2 0 3.6 13.2h4l2.6-5.2 2.6 5.2h4" />
      </svg>
      {busy ? "Redirection…" : "Connect with Strava"}
    </button>
  );
}

export function StravaTab() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getStravaStatus();
      setStatus(s);
      if (s.connected) setDash(await getStravaDashboard().catch(() => null));
      else setDash(null);
    } catch {
      setError("Impossible de charger l'état Strava.");
    }
  }, []);

  useEffect(() => {
    // Retour de Strava : ?strava=ok|denied|scope|error|invalid
    const p = new URLSearchParams(window.location.search).get("strava");
    if (p) {
      const msg: Record<string, string> = {
        ok: "✓ Compte Strava connecté. Première synchronisation en cours…",
        denied: "Connexion annulée : tu as refusé l'accès sur Strava.",
        scope: "Autorisations insuffisantes : coche bien « Voir les données de tes activités » sur l'écran Strava, puis réessaie.",
        limit: "Strava n'accepte pas de nouveau sportif pour le moment : l'application a atteint sa limite de comptes connectés. L'administrateur vient d'être prévenu, il doit demander à Strava d'augmenter cette limite. Réessaie dans quelques jours.",
        error: "Strava n'a pas pu valider la connexion. Réessaie dans un instant.",
        invalid: "Lien de connexion invalide ou expiré. Relance la connexion depuis cette page.",
      };
      setNotice(msg[p] ?? null);
      window.history.replaceState(null, "", `${window.location.pathname}#strava`);
    }
    void load();
    // La première synchronisation tourne en arrière-plan : on relit un peu plus tard.
    const t = p === "ok" ? setTimeout(() => void load(), 5000) : undefined;
    return () => t && clearTimeout(t);
  }, [load]);

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      window.location.href = await getStravaConnectUrl();
    } catch {
      setError("La connexion Strava n'est pas disponible pour le moment.");
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setError(null);
    const r = await syncStrava().catch(() => null);
    if (!r) setError("Synchronisation impossible.");
    else if (r.error) setError(r.error);
    else if (r.throttled) setNotice("Déjà synchronisé il y a moins d'une minute.");
    else setNotice(`✓ ${r.synced} sortie${r.synced > 1 ? "s" : ""} à vélo synchronisée${r.synced > 1 ? "s" : ""}.`);
    await load();
    setBusy(null);
  }

  async function disconnect() {
    if (!confirm("Déconnecter Strava ? Les jetons et toutes les sorties importées seront supprimés de ce site.")) return;
    setBusy("disconnect");
    const r = await disconnectStrava().catch(() => null);
    setNotice(r?.revoked ? "Strava déconnecté : l'accès a été révoqué chez Strava et tes données ont été effacées d'ici." : "Données effacées d'ici. Si l'accès n'a pas pu être révoqué chez Strava, retire-le dans strava.com → Paramètres → Mes applications.");
    setDash(null);
    await load();
    setBusy(null);
  }

  if (error && !status) return <div className="error-banner">{error}</div>;
  if (!status) return <p className="hint">Chargement…</p>;

  const acc = status.account;
  return (
    <div className="sv">
      {notice && <div className="sv-notice" role="status">{notice}</div>}
      {error && <div className="error-banner">{error}</div>}

      {!status.connected && (
        <section className="panel sv-hero">
          <h2 style={{ marginTop: 0 }}>Connecte ton compte Strava</h2>
          <p>
            Retrouve ici ton volume, ta forme et la fatigue accumulée, et reçois les conseils de ton Coach d'après tes vraies sorties. Les données restent sur ce serveur ; tu peux tout effacer en un clic.
          </p>
          <ul className="sv-bullets">
            <li>Lecture seule : le site ne publie ni ne modifie rien sur Strava</li>
            <li>Autorisations demandées : profil, activités (y compris privées), zones cardiaques</li>
            <li>Aucune IA externe : l'analyse est calculée sur ce serveur</li>
          </ul>
          {status.configured ? (
            <>
              <ConnectButton onClick={connect} busy={busy === "connect"} />
              <p className="sv-sub">Si Strava affiche une erreur de limite ou refuse l'autorisation, préviens l'administrateur du site : l'application Strava doit être autorisée pour plusieurs sportifs.</p>
            </>
          ) : (
            <div className="sv-warn">
              ⚠️ L'intégration Strava n'est pas configurée sur le serveur. Variable{(status.missing?.length ?? 0) > 1 ? "s" : ""} non vue{(status.missing?.length ?? 0) > 1 ? "s" : ""} par le serveur :{" "}
              {(status.missing ?? []).map((m) => (
                <code key={m} style={{ marginRight: 6 }}>{m}</code>
              ))}
              <div className="sv-sub" style={{ marginTop: 6 }}>
                Vérifie l'orthographe exacte dans <code>.env.production</code> (pas de espace autour du « = »), puis relance le déploiement : le conteneur doit être <strong>recréé</strong> pour relire le fichier (un simple redémarrage ne suffit pas).
              </div>
            </div>
          )}
        </section>
      )}

      {acc && (
        <section className="panel sv-status">
          <div className="sv-who">
            {acc.profilePhoto ? <img src={acc.profilePhoto} alt="" width={48} height={48} className="sv-avatar" /> : <span className="sv-avatar sv-avatar-ph" aria-hidden="true">🚴</span>}
            <div>
              <strong>{acc.athleteName}</strong>
              <div className="sv-badges">
                <span className={`sv-badge${acc.lastSyncError ? " is-bad" : ""}`}>
                  <i className="sv-dot-live" aria-hidden="true" /> {acc.lastSyncError ? "Erreur de synchro" : `Synchronisé ${ago(acc.lastSyncAt)}`}
                </span>
                {acc.ftp ? <span className="sv-badge">FTP {acc.ftp} W</span> : null}
                {acc.maxHr ? <span className="sv-badge">FC max {acc.maxHr}</span> : null}
              </div>
            </div>
          </div>
          <div className="sv-btns">
            <button type="button" className="ghost" onClick={sync} disabled={busy !== null}>
              {busy === "sync" ? "Synchronisation…" : "🔄 Synchroniser"}
            </button>
            <button type="button" className="ghost rb-danger" onClick={disconnect} disabled={busy !== null}>
              Déconnecter
            </button>
          </div>
          {acc.lastSyncError && <div className="sv-warn">⚠️ {acc.lastSyncError}</div>}
          {!acc.scopeOk && <div className="sv-warn">⚠️ L'accès aux activités n'a pas été accordé : reconnecte-toi en cochant « Voir les données de tes activités ».</div>}
        </section>
      )}

      {acc && !dash && !error && <p className="hint">Chargement du tableau de bord…</p>}

      {dash && dash.empty && (
        <section className="panel">
          <p style={{ margin: 0 }}>Aucune sortie à vélo trouvée sur les 13 derniers mois. Fais une sortie ou clique sur « Synchroniser » : le tableau de bord se remplira tout seul.</p>
        </section>
      )}

      {dash && !dash.empty && (
        <>
          <div className="sv-bento">
            {(
              [
                ["7 jours", dash.kpis.d7],
                ["30 jours", dash.kpis.d30],
                [`Année ${new Date().getFullYear()}`, dash.kpis.year],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="sv-card">
                <div className="sv-label">{label}</div>
                <div className="sv-big tabular">
                  {fmt(v.km)} <small>km</small>
                </div>
                <div className="sv-sub tabular">
                  {fmt(v.hours, 1)} h · {fmt(v.elevationM)} m D+ · {v.rides} sortie{v.rides > 1 ? "s" : ""}
                </div>
              </div>
            ))}
            <div className="sv-card">
              <div className="sv-label" title="Charge des 7 derniers jours ÷ charge hebdomadaire moyenne des 28 derniers jours">
                Ratio charge aiguë / chronique
              </div>
              <AcwrGauge acwr={dash.fitness.acwr} />
            </div>
            <div className="sv-card">
              <div className="sv-label">Forme · Fatigue · Fraîcheur</div>
              <div className="sv-trio tabular">
                <div><b>{fmt(dash.fitness.ctl)}</b><span>Forme</span></div>
                <div><b>{fmt(dash.fitness.atl)}</b><span>Fatigue</span></div>
                <div><b className={dash.fitness.tsb < -20 ? "sv-lvl-alerte" : dash.fitness.tsb > 5 ? "sv-lvl-ok" : ""}>{dash.fitness.tsb > 0 ? "+" : ""}{fmt(dash.fitness.tsb)}</b><span>Fraîcheur</span></div>
              </div>
            </div>
            <div className="sv-card sv-wide">
              <div className="sv-label">Répartition des intensités</div>
              <IntensityBar share={dash.intensity.week.coveredSeconds > 0 ? dash.intensity.week : dash.intensity.month} label={dash.intensity.week.coveredSeconds > 0 ? "cette semaine" : "ces 4 semaines"} />
              <div className="sv-sub">{dash.intensity.week.coveredSeconds > 0 ? "Cette semaine" : "Sur 4 semaines"} · estimé d'après la FC ou la puissance moyenne de chaque sortie</div>
            </div>
            <div className="sv-card sv-wide">
              <div className="sv-label">Les 8 dernières semaines</div>
              <TrendChart weekly={dash.weekly} />
            </div>
          </div>

          <CoachCard coach={dash.coach} />
        </>
      )}

      <section className="panel">
        <Disclosure title="⚙️ Réglages du Coach" summary="Profil, ton, bilans automatiques, métriques" storageKey="strava.coach">
          <CoachSettings onSaved={() => void load()} />
        </Disclosure>
        <Disclosure title="🤖 Connecteurs IA officiels" summary="Claude · Google Gemini (serveur MCP Strava)" storageKey="strava.ia">
          <AiConnectors />
        </Disclosure>
      </section>
    </div>
  );
}
