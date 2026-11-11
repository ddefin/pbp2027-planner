import { useState } from "react";
import type { TrackPoint } from "../../api/brmCatalog";
import type { RoadbookControl } from "../../lib/roadbook";
import { snapToRoute } from "../../lib/roadbook";

export interface LivePosition {
  km: number;
  lat: number | null;
  lon: number | null;
  at: string;
  source: "gps" | "manuel" | "controle";
  offsetKm?: number;
  accuracyM?: number;
}

// Au-delà, la position GPS n'est probablement pas sur le parcours (détour, erreur de
// route) : on l'enregistre quand même mais on prévient.
const OFF_ROUTE_KM = 0.5;

type Feedback = { kind: "ok" | "warn" | "error"; text: string } | null;

// Pointage À LA DEMANDE uniquement : le GPS n'est allumé que le temps d'UN relevé,
// quand le randonneur appuie sur le bouton — jamais de suivi continu, pas d'écran
// maintenu allumé. C'est ce pointage qui alimente le statut et la page de suivi
// partagée. Coût batterie : celui d'une seule localisation (quelques secondes).
export function LiveTracker({
  points,
  controls,
  lastKm,
  onPosition,
  onReset,
}: {
  points: TrackPoint[];
  controls: RoadbookControl[];
  lastKm: number | null;
  onPosition: (p: LivePosition) => Promise<boolean>;
  onReset: () => void;
}) {
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [manualKm, setManualKm] = useState("");
  const [controlIdx, setControlIdx] = useState(0);

  const total = points.length ? points[points.length - 1].distKm : 0;
  const time = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  async function submit(p: LivePosition, label: string) {
    const sent = await onPosition(p);
    setFeedback(
      sent
        ? { kind: p.offsetKm !== undefined && p.offsetKm > OFF_ROUTE_KM ? "warn" : "ok", text: `${label} — partagé à ${time()}` }
        : { kind: "error", text: `${label} — affiché ici mais PAS envoyé (pas de réseau ?). Réessaie un peu plus loin.` },
    );
  }

  function pointGps() {
    if (!navigator.geolocation) {
      setFeedback({ kind: "error", text: "Géolocalisation non disponible sur cet appareil : saisis le km à la main." });
      return;
    }
    setLocating(true);
    setFeedback(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const snapped = snapToRoute(points, p, lastKm);
        const off = snapped.offsetKm > OFF_ROUTE_KM ? ` · ⚠️ à ${snapped.offsetKm.toFixed(1)} km du tracé` : "";
        await submit(
          { km: snapped.km, ...p, at: new Date(pos.timestamp).toISOString(), source: "gps", offsetKm: snapped.offsetKm, accuracyM: pos.coords.accuracy },
          `📍 km ${Math.round(snapped.km)} (±${Math.round(pos.coords.accuracy)} m)${off}`,
        );
      },
      (err) => {
        setLocating(false);
        setFeedback({
          kind: "error",
          text: err.code === err.PERMISSION_DENIED ? "Accès à la position refusé (réglages du navigateur) : saisis le km à la main." : "Position introuvable pour le moment (sous-bois, tunnel ?) : réessaie ou saisis le km.",
        });
      },
      // Une position de moins d'une minute suffit (déjà connue du téléphone = zéro
      // coût) ; 20 s max pour en obtenir une nouvelle, puis on abandonne.
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
    );
  }

  return (
    <div className="live-tracker">
      <div className="live-row">
        <button type="button" className="primary" onClick={pointGps} disabled={locating} style={{ width: "auto", padding: "12px 20px", fontSize: 16 }}>
          {locating ? "Localisation…" : "📍 Pointer ma position"}
        </button>
      </div>

      <div className="live-row">
        <form
          className="live-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const km = Number(manualKm.replace(",", "."));
            if (!Number.isFinite(km) || km < 0 || km > total + 1) {
              setFeedback({ kind: "error", text: `Km invalide (0 à ${Math.round(total)}).` });
              return;
            }
            setManualKm("");
            void submit({ km, lat: null, lon: null, at: new Date().toISOString(), source: "manuel" }, `✍️ km ${Math.round(km)}`);
          }}
        >
          <input className="rb-input rb-input-num" inputMode="decimal" placeholder="km" value={manualKm} onChange={(e) => setManualKm(e.target.value)} aria-label="Kilomètre actuel" />
          <button type="submit" className="ghost">
            Je suis à ce km
          </button>
        </form>
        <div className="live-inline">
          <select className="rb-input" value={controlIdx} onChange={(e) => setControlIdx(Number(e.target.value))} aria-label="Contrôle pointé">
            {controls.map((c, i) => (
              <option key={`${c.km}-${i}`} value={i}>
                {c.name} (km {Math.round(c.km)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const c = controls[controlIdx];
              if (c) void submit({ km: c.km, lat: c.lat ?? null, lon: c.lon ?? null, at: new Date().toISOString(), source: "controle" }, `✔ ${c.name}`);
            }}
          >
            Pointé ✔
          </button>
        </div>
      </div>

      {feedback && <div className={`live-feedback live-feedback-${feedback.kind}`}>{feedback.text}</div>}

      <p className="hint" style={{ marginBottom: 0 }}>
        Aucun suivi en continu : le GPS ne s'allume qu'au moment où tu pointes, le temps d'une localisation. Chaque pointage met
        à jour ton statut et la page de suivi de tes proches. Sans réseau, saisis le km ou le contrôle — rien n'est consommé.{" "}
        <button type="button" className="linklike" onClick={() => confirm("Effacer toutes les positions enregistrées pour ce roadbook ?") && onReset()}>
          Réinitialiser le suivi
        </button>
      </p>
    </div>
  );
}
