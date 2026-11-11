import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api/auth";
import { getTelegramStatus, type TelegramStatus } from "../../api/profile";
import { testTrackingChannel, updateRoadbook, type AnnounceStatus } from "../../api/roadbooks";
import { useAuth } from "../../context/AuthContext";

const GARMIN_HOSTS = ["livetrack.garmin.com", "share.garmin.com", "connect.garmin.com", "gar.mn"];

function isGarminUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && GARMIN_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

const hhmm = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

// Carte « Garmin LiveTrack » : c'est le compteur qui envoie sa position (via Garmin
// Connect), sans rien demander au téléphone ni au serveur.
export function LiveTrackCard({
  roadbookId,
  liveTrackUrl,
  onSaved,
}: {
  roadbookId: string;
  liveTrackUrl: string | null;
  onSaved: (patch: { liveTrackUrl: string | null }) => void;
}) {
  const [url, setUrl] = useState(liveTrackUrl ?? "");
  const [state, setState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (value && !isGarminUrl(value)) {
      setState({ kind: "error", text: "Colle le lien LiveTrack reçu de Garmin (https://livetrack.garmin.com/…)." });
      return;
    }
    try {
      await updateRoadbook(roadbookId, { liveTrackUrl: value || null });
      onSaved({ liveTrackUrl: value || null });
      setState({ kind: "ok", text: value ? "✓ Lien enregistré : visible par tes proches et sur le canal." : "✓ Lien retiré." });
    } catch (err) {
      setState({ kind: "error", text: err instanceof ApiError && err.status === 400 ? "Lien refusé : seuls les liens Garmin LiveTrack sont acceptés." : "Échec de l'enregistrement." });
    }
  }

  return (
    <div className="rb-card">
      <h3 className="rb-card-title">📡 Garmin LiveTrack</h3>
      <p className="hint" style={{ margin: 0 }}>
        C'est ton compteur Garmin qui envoie sa position (via Garmin Connect) : rien à faire sur cette page. Démarre LiveTrack au
        départ, copie le lien de l'email ou de l'app Garmin Connect, colle-le ici. Le lien change à chaque activité.
      </p>
      <form onSubmit={save} style={{ display: "flex", gap: 6 }}>
        <input
          className="rb-input"
          style={{ flex: 1 }}
          type="url"
          inputMode="url"
          placeholder="https://livetrack.garmin.com/session/…"
          aria-label="Lien Garmin LiveTrack"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setState(null);
          }}
        />
        <button type="submit" className="ghost">
          Enregistrer
        </button>
      </form>
      {state && <div className={`live-feedback live-feedback-${state.kind}`}>{state.text}</div>}
    </div>
  );
}

// Carte « Canal Telegram » : publication automatique du résumé à chaque pointage, état de
// la dernière publication, test admin, et mode d'emploi pour pointer depuis Telegram.
export function TelegramCard({
  roadbookId,
  telegramAnnounce,
  announceStatus,
  onSaved,
}: {
  roadbookId: string;
  telegramAnnounce: boolean;
  announceStatus?: AnnounceStatus;
  onSaved: (patch: { telegramAnnounce: boolean }) => void;
}) {
  const { user } = useAuth();
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [test, setTest] = useState<{
    busy: boolean;
    text: string | null;
    ok?: boolean;
    configured?: string | null;
    chats?: { chatId: string; title: string; type: string; botStatus: string | null }[];
  }>({ busy: false, text: null });

  useEffect(() => {
    getTelegramStatus().then(setTelegram).catch(() => undefined);
  }, []);

  async function toggle(next: boolean) {
    onSaved({ telegramAnnounce: next });
    await updateRoadbook(roadbookId, { telegramAnnounce: next }).catch(() => onSaved({ telegramAnnounce: !next }));
  }

  async function runTest() {
    setTest({ busy: true, text: null });
    try {
      const r = await testTrackingChannel();
      const source = r.usingFallback ? " — c'est le canal des ACTUALITÉS, TELEGRAM_TRACKING_CHAT_ID n'est pas lue" : "";
      setTest({
        busy: false,
        ok: r.ok,
        configured: r.chatId,
        chats: r.knownChats,
        text: r.ok
          ? `✓ Message de test publié sur le canal ${r.chatId}${source}.`
          : `⚠️ ${r.hint} — Réponse de Telegram : ${r.error}${r.chatId ? ` (identifiant utilisé : ${r.chatId}${source})` : ""}`,
      });
    } catch {
      setTest({ busy: false, ok: false, text: "Test impossible (serveur injoignable)." });
    }
  }

  return (
    <div className="rb-card">
      <h3 className="rb-card-title">✈️ Canal Telegram du groupe</h3>

      <label className="rb-check">
        <input type="checkbox" checked={telegramAnnounce} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          Publier un résumé de ma situation sur le canal à chaque pointage{" "}
          <span className="hint">(km, avance/retard, moyennes, ville, arrivée estimée, météo)</span>
        </span>
      </label>

      {telegramAnnounce && announceStatus?.lastAttemptAt && (
        <div className={`live-feedback live-feedback-${announceStatus.lastError ? "error" : "ok"}`}>
          {announceStatus.lastError ? (
            <>
              ⚠️ Dernière publication ÉCHOUÉE ({hhmm(announceStatus.lastAttemptAt)}) : {announceStatus.hint}
              <div style={{ fontWeight: 400, fontSize: 12, marginTop: 2 }}>Réponse de Telegram : {announceStatus.lastError}</div>
            </>
          ) : (
            <>✓ Dernière publication réussie ({hhmm(announceStatus.lastAttemptAt)})</>
          )}
        </div>
      )}

      <div className="rb-telegram-help">
        <strong>Pointer depuis Telegram</strong> (sans ouvrir le site)
        {telegram && !telegram.configured ? (
          <p className="hint" style={{ margin: "4px 0 0" }}>Le bot Telegram n'est pas configuré sur ce serveur.</p>
        ) : telegram && !telegram.linked ? (
          <p className="hint" style={{ margin: "4px 0 0" }}>Lie d'abord ton compte : « Mon profil » → section Telegram.</p>
        ) : (
          <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            <li>
              Envoie ta position au bot{telegram?.botUsername ? ` @${telegram.botUsername}` : ""} : 📎 → Position → « Envoyer ma position
              actuelle » (un seul relevé, pas la position en direct)
            </li>
            <li>
              ou <code>/km 125</code>, ou <code>/cp</code> puis <code>/cp 2</code> au contrôle, ou <code>/statut</code>
            </li>
          </ul>
        )}
      </div>

      {user?.isAdmin && (
        <div className="rb-admin-test">
          <button type="button" className="ghost" disabled={test.busy} onClick={runTest}>
            {test.busy ? "Test en cours…" : "🔧 Tester la publication sur le canal (admin)"}
          </button>
          {test.text && <div className={`live-feedback live-feedback-${test.ok ? "ok" : "error"}`}>{test.text}</div>}
          {test.chats && (
            <div className="rb-known-chats">
              <strong>Canaux et groupes connus du bot</strong>
              {test.chats.length === 0 ? (
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  Aucun pour l'instant. Ajoute le bot comme administrateur du canal (ou retire-le puis rajoute-le s'il y était déjà),
                  publie un message dans le canal, puis relance le test.
                </p>
              ) : (
                <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {test.chats.map((c) => (
                    <li key={c.chatId}>
                      « {c.title} » → <code>{c.chatId}</code>
                      {c.botStatus === "administrator" ? " · bot administrateur ✓" : c.botStatus ? ` · bot : ${c.botStatus} ✗ (doit être administrateur)` : ""}
                      {c.chatId === test.configured ? " · ← identifiant configuré" : ""}
                    </li>
                  ))}
                </ul>
              )}
              {test.chats.length > 0 && !test.chats.some((c) => c.chatId === test.configured) && (
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  L'identifiant configuré ne correspond à aucun de ces canaux : mets la bonne valeur dans TELEGRAM_TRACKING_CHAT_ID
                  (fichier <code>.env.production</code>), puis <code>sudo docker compose up -d --force-recreate</code>.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
