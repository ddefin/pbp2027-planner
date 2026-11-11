import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api/auth";
import { getTelegramStatus, type TelegramStatus } from "../../api/profile";
import { updateRoadbook } from "../../api/roadbooks";

const GARMIN_HOSTS = ["livetrack.garmin.com", "share.garmin.com", "connect.garmin.com", "gar.mn"];

function isGarminUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && GARMIN_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

// Réglages du suivi par les proches : lien Garmin LiveTrack (position du compteur, sans
// toucher au téléphone) et publication du résumé de situation sur le canal Telegram du
// groupe à chaque pointage — avec le mode d'emploi pour pointer depuis Telegram.
export function TrackingSettings({
  roadbookId,
  liveTrackUrl,
  telegramAnnounce,
  onSaved,
}: {
  roadbookId: string;
  liveTrackUrl: string | null;
  telegramAnnounce: boolean;
  onSaved: (patch: { liveTrackUrl?: string | null; telegramAnnounce?: boolean }) => void;
}) {
  const [url, setUrl] = useState(liveTrackUrl ?? "");
  const [urlState, setUrlState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);

  useEffect(() => {
    getTelegramStatus().then(setTelegram).catch(() => undefined);
  }, []);

  async function saveUrl(e: FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (value && !isGarminUrl(value)) {
      setUrlState({ kind: "error", text: "Colle le lien LiveTrack reçu de Garmin (https://livetrack.garmin.com/…)." });
      return;
    }
    try {
      await updateRoadbook(roadbookId, { liveTrackUrl: value || null });
      onSaved({ liveTrackUrl: value || null });
      setUrlState({ kind: "ok", text: value ? "✓ Lien enregistré : visible par tes proches et sur le canal." : "✓ Lien retiré." });
    } catch (err) {
      setUrlState({ kind: "error", text: err instanceof ApiError && err.status === 400 ? "Lien refusé : seuls les liens Garmin LiveTrack sont acceptés." : "Échec de l'enregistrement." });
    }
  }

  async function toggleAnnounce(next: boolean) {
    onSaved({ telegramAnnounce: next });
    await updateRoadbook(roadbookId, { telegramAnnounce: next }).catch(() => onSaved({ telegramAnnounce: !next }));
  }

  return (
    <div className="rb-share">
      <strong>Suivi par les proches</strong>

      <form onSubmit={saveUrl} className="rb-livetrack-form">
        <label htmlFor="rb-livetrack" className="hint" style={{ margin: 0, fontWeight: 700 }}>
          Lien Garmin LiveTrack (optionnel)
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            id="rb-livetrack"
            className="rb-input"
            style={{ flex: 1 }}
            type="url"
            inputMode="url"
            placeholder="https://livetrack.garmin.com/session/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlState(null);
            }}
          />
          <button type="submit" className="ghost">
            Enregistrer
          </button>
        </div>
        {urlState && <div className={`live-feedback live-feedback-${urlState.kind}`}>{urlState.text}</div>}
        <p className="hint" style={{ margin: 0 }}>
          C'est ton compteur Garmin qui envoie sa position (via Garmin Connect) : rien à faire sur cette page. Démarre LiveTrack au
          départ, copie le lien de l'email ou de l'app Garmin Connect, colle-le ici. Le lien change à chaque activité.
        </p>
      </form>

      <label className="rb-check">
        <input type="checkbox" checked={telegramAnnounce} onChange={(e) => void toggleAnnounce(e.target.checked)} />
        <span>
          Publier un résumé de ma situation sur le canal Telegram du groupe à chaque pointage <span className="hint">(km, avance/retard,
          moyennes, ville, arrivée estimée, météo)</span>
        </span>
      </label>

      <div className="rb-telegram-help">
        <strong>Pointer depuis Telegram</strong> (sans ouvrir le site)
        {telegram && !telegram.configured ? (
          <p className="hint" style={{ margin: "4px 0 0" }}>Le bot Telegram n'est pas configuré sur ce serveur.</p>
        ) : telegram && !telegram.linked ? (
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Lie d'abord ton compte : « Mon profil » → section Telegram.
          </p>
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
    </div>
  );
}
