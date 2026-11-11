import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteRoadbook,
  getRoadbook,
  postCheckin,
  resetCheckins,
  roadbookGpxUrl,
  setRoadbookSharing,
  updateRoadbook,
  type RoadbookSettings,
} from "../api/roadbooks";
import { RoadbookView, type RoadbookData } from "../components/roadbook/RoadbookView";
import { LiveTracker, type LivePosition } from "../components/roadbook/LiveTracker";

const SAVE_DEBOUNCE_MS = 700;
// Rythme d'envoi des positions GPS au serveur (pour le lien de partage) : assez
// fréquent pour un suivi utile, assez rare pour ne pas vider la batterie ni le forfait.
const GPS_POST_INTERVAL_MS = 5 * 60_000;

export function RoadbookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<(RoadbookData & { id: string }) | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pending = useRef<Partial<RoadbookSettings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPost = useRef<{ at: number; km: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    getRoadbook(id)
      .then(({ roadbook, checkins }) => {
        setData(roadbook);
        setShareToken(roadbook.shareToken);
        const last = checkins[0];
        if (last) {
          setPosition({ km: last.km, lat: last.lat, lon: last.lon, at: last.at, source: last.source });
          lastPost.current = { at: new Date(last.at).getTime(), km: last.km };
        }
      })
      .catch(() => setError("Roadbook introuvable."));
  }, [id]);

  // Chaque modification est appliquée tout de suite à l'écran, puis enregistrée par
  // lots (curseur de vitesse glissé = une seule requête, pas une par cran).
  const handleChange = useCallback(
    (patch: Partial<RoadbookSettings>) => {
      if (!id) return;
      setData((prev) => (prev ? { ...prev, ...patch } : prev));
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      setSaveState("saving");
      timer.current = setTimeout(async () => {
        const body = pending.current;
        pending.current = {};
        try {
          await updateRoadbook(id, body);
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [id],
  );

  // Envoie la position si c'est un pointage manuel, ou pour le GPS : la première, puis
  // toutes les 5 min, et à chaque contrôle franchi depuis le dernier envoi.
  const handlePosition = useCallback(
    (p: LivePosition) => {
      if (!id || !data) return;
      setPosition(p);
      const prev = lastPost.current;
      const crossedControl = prev !== null && data.controls.some((c) => c.km > prev.km && c.km <= p.km);
      const due = p.source !== "gps" || prev === null || Date.now() - prev.at >= GPS_POST_INTERVAL_MS || crossedControl;
      if (!due) return;
      lastPost.current = { at: Date.now(), km: p.km };
      postCheckin(id, { km: Math.round(p.km * 100) / 100, lat: p.lat, lon: p.lon, source: p.source }).catch(() => {
        lastPost.current = prev; // réessaiera au prochain point
      });
    },
    [id, data],
  );

  if (error) return <div className="wrap"><div className="error-banner">{error}</div></div>;
  if (!data) return <p className="hint" style={{ padding: 24 }}>Chargement du roadbook…</p>;

  const shareUrl = shareToken ? `${window.location.origin}/r/${shareToken}` : null;

  return (
    <RoadbookView
      data={data}
      position={position}
      editable
      onChange={handleChange}
      live={
        <div className="rb-live">
          <h3 className="rb-h3">Suivi en direct</h3>
          <LiveTracker
            points={data.points}
            controls={[...data.controls].sort((a, b) => a.km - b.km)}
            lastKm={position?.km ?? null}
            onPosition={handlePosition}
            onReset={async () => {
              await resetCheckins(data.id);
              setPosition(null);
              lastPost.current = null;
            }}
          />
        </div>
      }
      actions={
        <div className="rb-actions">
          <div className="rb-save hint" style={{ margin: 0 }}>
            {saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "✓ Enregistré" : saveState === "error" ? "⚠️ Échec de l'enregistrement" : ""}
          </div>
          <button type="button" className="primary" style={{ width: "auto", padding: "10px 18px" }} onClick={() => window.print()}>
            🖨️ Exporter en PDF
          </button>
          <a className="ghost-link" href={roadbookGpxUrl(data.id)} download>
            Télécharger le GPX
          </a>

          <div className="rb-share">
            <strong>Lien de suivi</strong>
            {shareUrl ? (
              <>
                <input className="rb-input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} aria-label="Lien de partage" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ghost"
                    onClick={async () => {
                      if (navigator.share) await navigator.share({ title: data.title, url: shareUrl }).catch(() => undefined);
                      else {
                        await navigator.clipboard.writeText(shareUrl).catch(() => undefined);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                  >
                    {copied ? "Copié ✓" : "Partager"}
                  </button>
                  <button type="button" className="ghost" onClick={async () => setShareToken(await setRoadbookSharing(data.id, true))}>
                    Nouveau lien
                  </button>
                  <button type="button" className="ghost" onClick={async () => setShareToken(await setRoadbookSharing(data.id, false))}>
                    Désactiver
                  </button>
                </div>
                {!data.startAt && (
                  <div className="pbp-banner" style={{ margin: 0 }}>
                    Pas d'heure de départ renseignée : tes proches verront le parcours mais aucun horaire de passage ni suivi.
                  </div>
                )}
                <p className="hint" style={{ margin: 0 }}>
                  Toute personne qui a ce lien voit ton roadbook et tes positions déclarées, sans compte. « Nouveau lien » rend
                  l'ancien inutilisable.
                </p>
              </>
            ) : (
              <button type="button" className="ghost" onClick={async () => setShareToken(await setRoadbookSharing(data.id, true))}>
                Créer un lien de suivi pour mes proches
              </button>
            )}
          </div>

          <button
            type="button"
            className="ghost rb-danger"
            onClick={async () => {
              if (!confirm(`Supprimer le roadbook « ${data.title} » et son suivi ?`)) return;
              await deleteRoadbook(data.id);
              navigate("/roadbooks", { replace: true });
            }}
          >
            Supprimer ce roadbook
          </button>
        </div>
      }
    />
  );
}
