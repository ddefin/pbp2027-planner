import { useState } from "react";
import { setRoadbookSharing, type AnnounceStatus } from "../../api/roadbooks";
import { WhatsAppShare } from "./WhatsAppShare";

function shareLinkUrl(token: string | null): string | null {
  return token ? `${window.location.origin}/r/${token}` : null;
}

// Copie ou partage (feuille de partage du téléphone quand elle existe) le lien de suivi.
async function shareOrCopy(title: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch {
      return "failed"; // fermée par l'utilisateur
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

// Carte « Lien de suivi » : le lien public que les proches ouvrent pour voir le roadbook
// et la dernière position, sans compte.
export function ShareLinkCard({
  roadbookId,
  title,
  startAt,
  shareToken,
  onShareToken,
}: {
  roadbookId: string;
  title: string;
  startAt: string | null;
  shareToken: string | null;
  onShareToken: (token: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = shareLinkUrl(shareToken);

  return (
    <div className="rb-card">
      <h3 className="rb-card-title">🔗 Lien de suivi pour mes proches</h3>
      {url ? (
        <>
          <input className="rb-input" style={{ width: "100%" }} readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Lien de suivi" />
          <div className="rb-card-actions">
            <button
              type="button"
              className="primary"
              style={{ width: "auto", padding: "9px 16px" }}
              onClick={async () => {
                if ((await shareOrCopy(title, url)) === "copied") {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? "Copié ✓" : "Partager le lien"}
            </button>
            <button type="button" className="ghost" onClick={async () => onShareToken(await setRoadbookSharing(roadbookId, true))}>
              Nouveau lien
            </button>
            <button type="button" className="ghost" onClick={async () => onShareToken(await setRoadbookSharing(roadbookId, false))}>
              Désactiver
            </button>
          </div>
          {!startAt && (
            <div className="pbp-banner" style={{ margin: 0 }}>
              Pas d'heure de départ renseignée : tes proches verront le parcours mais aucun horaire de passage ni suivi (onglet Réglages).
            </div>
          )}
          <p className="hint" style={{ margin: 0 }}>
            Toute personne qui a ce lien voit ton roadbook et tes positions déclarées, sans compte. « Nouveau lien » rend
            l'ancien inutilisable ; « Désactiver » coupe tout accès.
          </p>
        </>
      ) : (
        <>
          <p className="hint" style={{ margin: 0 }}>
            Une page en lecture seule, mise à jour à chaque pointage : le parcours, tes horaires, ta dernière position et le
            statut avance/retard. Aucun compte nécessaire pour la consulter.
          </p>
          <div className="rb-card-actions">
            <button
              type="button"
              className="primary"
              style={{ width: "auto", padding: "9px 16px" }}
              onClick={async () => onShareToken(await setRoadbookSharing(roadbookId, true))}
            >
              Créer le lien de suivi
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function WhatsAppCard({ text, at }: { text: string | null; at?: string | null }) {
  return (
    <div className="rb-card">
      <h3 className="rb-card-title">📲 WhatsApp</h3>
      <p className="hint" style={{ margin: 0 }}>
        WhatsApp ne permet pas de publier automatiquement dans un groupe : le bouton ouvre WhatsApp avec le résumé de ta
        situation déjà rédigé, tu choisis le groupe et tu envoies.
      </p>
      {text ? <WhatsAppShare text={text} at={at} /> : <p className="hint" style={{ margin: 0 }}>Disponible dès ton premier pointage.</p>}
    </div>
  );
}

function telegramLine(announce: boolean, status?: AnnounceStatus): { text: string; level: "ok" | "off" | "error" | "idle" } {
  if (!announce) return { text: "Canal Telegram : désactivé", level: "off" };
  if (!status?.lastAttemptAt) return { text: "Canal Telegram : actif (rien publié pour l'instant)", level: "idle" };
  const when = new Date(status.lastAttemptAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return status.lastError ? { text: `Canal Telegram : échec à ${when}`, level: "error" } : { text: `Canal Telegram : publié à ${when}`, level: "ok" };
}

// Accès rapide au partage, dans l'onglet Suivi : le jour J, on pointe et on partage au
// même endroit, sans aller chercher dans les réglages.
export function QuickShare({
  roadbookId,
  title,
  shareToken,
  onShareToken,
  whatsapp,
  telegramAnnounce,
  announceStatus,
  onOpenSharing,
}: {
  roadbookId: string;
  title: string;
  shareToken: string | null;
  onShareToken: (token: string | null) => void;
  whatsapp: { text: string; at: string } | null;
  telegramAnnounce: boolean;
  announceStatus?: AnnounceStatus;
  onOpenSharing: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = shareLinkUrl(shareToken);
  const tg = telegramLine(telegramAnnounce, announceStatus);

  return (
    <div className="rb-quick">
      <div className="rb-quick-title">Partager ma situation</div>
      <div className="rb-quick-buttons">
        {whatsapp ? (
          <WhatsAppShare text={whatsapp.text} compact />
        ) : (
          <span className="hint" style={{ margin: 0 }}>📲 WhatsApp dès ton 1er pointage</span>
        )}
        {url ? (
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              if ((await shareOrCopy(title, url)) === "copied") {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
          >
            {copied ? "Copié ✓" : "🔗 Lien de suivi"}
          </button>
        ) : (
          <button type="button" className="ghost" onClick={async () => onShareToken(await setRoadbookSharing(roadbookId, true))}>
            🔗 Créer le lien de suivi
          </button>
        )}
      </div>
      <div className="rb-quick-status">
        <span className={`rb-dot rb-dot-${tg.level}`} aria-hidden="true" />
        {tg.text}
        <button type="button" className="linklike" style={{ marginLeft: "auto" }} onClick={onOpenSharing}>
          Réglages du partage →
        </button>
      </div>
    </div>
  );
}
