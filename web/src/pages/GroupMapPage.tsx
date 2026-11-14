import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getGroupLive, type GroupRider } from "../api/roadbooks";
import { Avatar } from "../components/Avatar";
import { addBaseLayers } from "../lib/mapLayers";

const REFRESH_MS = 2 * 60_000;
const LEVEL: Record<string, { label: string; cls: string }> = {
  ok: { label: "Dans les temps", cls: "ok" },
  tight: { label: "Marge serrée", cls: "tight" },
  late: { label: "En retard sur la barrière", cls: "late" },
};

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Repère d'un randonneur sur la carte : son initiale (ou sa photo) et son prénom.
function markerHtml(r: GroupRider): string {
  const inner = r.avatar?.kind === "photo" ? `<img src="${esc(r.avatar.url)}" alt="" />` : esc(r.prenom.slice(0, 1).toUpperCase());
  return `<div class="gm-pin${r.mine ? " is-me" : ""}${r.level === "late" ? " is-late" : ""}"><span class="gm-pin-av">${inner}</span><span class="gm-pin-name">${esc(r.prenom)}</span></div>`;
}

// Carte du groupe le jour J : dernier pointage des membres qui l'ont accepté dans leur
// roadbook, pendant leur brevet. Rafraîchie toutes les 2 minutes (page visible).
export function GroupMapPage() {
  const [riders, setRiders] = useState<GroupRider[] | null>(null);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getGroupLive()
        .then((d) => alive && (setRiders(d.riders), setUpdatedAt(d.at), setError(false)))
        .catch(() => alive && setError(true));
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!boxRef.current) return;
    const map = L.map(boxRef.current, { preferCanvas: true, zoomSnap: 0.25 });
    layerRef.current = L.layerGroup().addTo(map);
    addBaseLayers(map, "Plan IGN");
    map.setView([48.4, -1.3], 6);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(boxRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !riders) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const r of riders) {
      L.polyline(r.track, { color: r.mine ? "#e8536a" : "#64748b", weight: r.id === focus ? 4 : 2.5, opacity: r.id === focus || !focus ? 0.8 : 0.35 }).addTo(layer);
      L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "", html: markerHtml(r), iconSize: [0, 0] }), zIndexOffset: r.id === focus ? 1000 : 0, title: `${r.prenom} — km ${Math.round(r.km)}` })
        .on("click", () => setFocus(r.id))
        .addTo(layer);
      bounds.push([r.lat, r.lon]);
    }
    // Cadrage une seule fois (ne pas déplacer la carte sous les doigts à chaque rafraîchissement).
    if (!fitted.current && bounds.length > 0) {
      fitted.current = true;
      if (bounds.length === 1) map.setView(bounds[0], 10);
      else map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 11 });
    }
  }, [riders, focus]);

  function center(r: GroupRider) {
    setFocus(r.id);
    mapRef.current?.setView([r.lat, r.lon], Math.max(mapRef.current.getZoom(), 10));
  }

  return (
    <div className="wrap-wide gm">
      <section className="panel">
        <div className="gm-head">
          <h2>Carte du groupe</h2>
          {updatedAt && <span className="hint" style={{ margin: 0 }}>Mise à jour {ago(updatedAt)}</span>}
        </div>
        <p className="hint">
          Dernier pointage des randonneurs en brevet qui ont accepté d'apparaître ici. Pas de suivi GPS : la position est celle de leur dernier pointage.
        </p>
        {error && <div className="error-banner">Impossible de charger la carte du groupe.</div>}
        <div ref={boxRef} className="gm-map" role="application" aria-label="Carte des derniers pointages du groupe" />

        {riders && riders.length === 0 && (
          <div className="gm-empty">
            <strong>Personne en brevet pour l'instant</strong>
            <p>
              Pour apparaître ici le jour J : ouvre ton <Link to="/roadbooks">roadbook</Link>, onglet Partage, et coche « Carte du groupe ». Tu seras visible de 12 h avant ton départ jusqu'à 6 h après le délai.
            </p>
          </div>
        )}

        {riders && riders.length > 0 && (
          <ul className="gm-list">
            {riders.map((r) => {
              const pct = Math.round((r.km / r.totalKm) * 100);
              const lvl = r.finished ? { label: "Arrivé", cls: "ok" } : r.level ? LEVEL[r.level] : null;
              return (
                <li key={r.id} className={`gm-rider${r.id === focus ? " is-focus" : ""}${r.mine ? " is-me" : ""}`}>
                  <button type="button" onClick={() => center(r)} aria-label={`Centrer la carte sur ${r.prenom}`}>
                    <Avatar name={r.prenom} avatar={r.avatar} size={36} />
                    <span className="gm-rider-main">
                      <strong>
                        {r.prenom}
                        {r.mine ? " (toi)" : ""}
                      </strong>
                      <small>{r.title}</small>
                      <span className="gm-bar" aria-hidden="true">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="gm-rider-side">
                      <strong className="gm-km">
                        {Math.round(r.km)} <small>/ {Math.round(r.totalKm)} km</small>
                      </strong>
                      <small>{r.checkinAt ? `pointé ${ago(r.checkinAt)}` : "pas encore parti"}</small>
                      {lvl && <small className={`lvl-text-${lvl.cls}`}>{lvl.label}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
