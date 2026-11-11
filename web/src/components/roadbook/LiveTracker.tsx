import { useEffect, useRef, useState } from "react";
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
// route, GPS qui dérive) : on l'affiche mais on prévient.
const OFF_ROUTE_KM = 0.5;

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
  onPosition: (p: LivePosition) => void;
  onReset: () => void;
}) {
  const [tracking, setTracking] = useState(false);
  const [gpsInfo, setGpsInfo] = useState<{ offsetKm: number; accuracyM: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualKm, setManualKm] = useState("");
  const [controlIdx, setControlIdx] = useState(0);
  const watchRef = useRef<number | null>(null);
  const lastKmRef = useRef(lastKm);
  lastKmRef.current = lastKm;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  useEffect(() => {
    if (!tracking) return;
    if (!navigator.geolocation) {
      setError("Géolocalisation non disponible sur cet appareil.");
      setTracking(false);
      return;
    }
    // Garde l'écran allumé pendant le suivi quand le navigateur le permet (sinon le
    // téléphone se verrouille et le GPS du navigateur s'arrête avec la page).
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((w) => (wakeLock = w)).catch(() => undefined);

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const snapped = snapToRoute(points, p, lastKmRef.current);
        setGpsInfo({ offsetKm: snapped.offsetKm, accuracyM: pos.coords.accuracy });
        onPositionRef.current({ km: snapped.km, ...p, at: new Date(pos.timestamp).toISOString(), source: "gps", offsetKm: snapped.offsetKm, accuracyM: pos.coords.accuracy });
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? "Accès à la position refusé (réglages du navigateur)." : "Position GPS indisponible pour le moment."),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      wakeLock?.release().catch(() => undefined);
    };
  }, [tracking, points]);

  const total = points.length ? points[points.length - 1].distKm : 0;

  return (
    <div className="live-tracker">
      <div className="live-row">
        <button type="button" className={tracking ? "primary live-on" : "primary"} onClick={() => setTracking((v) => !v)} style={{ width: "auto", padding: "10px 18px" }}>
          {tracking ? "⏹ Arrêter le suivi GPS" : "📡 Suivi GPS en direct"}
        </button>
        {tracking && gpsInfo && (
          <span className={`hint${gpsInfo.offsetKm > OFF_ROUTE_KM ? " live-warn" : ""}`} style={{ margin: 0 }}>
            {gpsInfo.offsetKm > OFF_ROUTE_KM ? `⚠️ à ${gpsInfo.offsetKm.toFixed(1)} km du tracé` : "sur le tracé"} · précision ±{Math.round(gpsInfo.accuracyM)} m
          </span>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="live-row">
        <form
          className="live-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const km = Number(manualKm.replace(",", "."));
            if (!Number.isFinite(km) || km < 0 || km > total + 1) return;
            onPosition({ km, lat: null, lon: null, at: new Date().toISOString(), source: "manuel" });
            setManualKm("");
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
              if (c) onPosition({ km: c.km, lat: c.lat ?? null, lon: c.lon ?? null, at: new Date().toISOString(), source: "controle" });
            }}
          >
            Pointé ✔
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Le suivi GPS garde l'écran allumé tant que la page est ouverte (la batterie en pâtit : sur un 600, préfère pointer
        à chaque contrôle). Les positions sont envoyées toutes les 5 min et à chaque contrôle, pour ceux qui suivent ton lien.{" "}
        <button type="button" className="linklike" onClick={() => confirm("Effacer toutes les positions enregistrées pour ce roadbook ?") && onReset()}>
          Réinitialiser le suivi
        </button>
      </p>
    </div>
  );
}
