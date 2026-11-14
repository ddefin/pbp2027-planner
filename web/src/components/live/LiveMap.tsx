import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";
import type { TrackPoint } from "../../api/brmCatalog";
import type { Checkin } from "../../api/roadbooks";
import { addBaseLayers } from "../../lib/mapLayers";
import { pointAtKm } from "../../lib/routeMath";
import { CHECKIN_STATUS_LABEL } from "../../lib/roadbook";
import { hhmm, km as kmFmt, when, type LiveModel } from "./model";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Bloc 2 : tracé fait (plein) / restant (pointillé), contrôles passés et à venir, dernier
// pointage mis en valeur, position estimée (jamais présentée comme réelle).
export function LiveMap({ points, model, now }: { points: TrackPoint[]; model: LiveModel; now: Date }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const focusRef = useRef<L.LatLng | null>(null);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { zoomSnap: 0.25, scrollWheelZoom: false });
    addBaseLayers(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])), { padding: [24, 24] });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(boxRef.current);
    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const accent = cssVar("--accent", "#e8536a");
    const done = points.filter((p) => p.distKm <= model.lastKm);
    const cut = pointAtKm(points, model.lastKm);
    const rest = points.filter((p) => p.distKm > model.lastKm);
    const ll = (p: { lat: number; lon: number }) => [p.lat, p.lon] as [number, number];

    // Restant d'abord (en dessous), puis le fait par-dessus.
    L.polyline([ll(cut), ...rest.map(ll)], { color: "#64748b", weight: 4, opacity: 0.55, dashArray: "2 9", lineCap: "round" }).addTo(layer);
    if (model.last) {
      L.polyline([...done.map(ll), ll(cut)], { color: "#ffffff", weight: 8, opacity: 0.8 }).addTo(layer);
      L.polyline([...done.map(ll), ll(cut)], { color: accent, weight: 5, opacity: 1 }).addTo(layer);
    }

    // Contrôles.
    model.schedule.forEach((row, i) => {
      const passedAt = model.passages[i];
      const passed = model.last !== null && (passedAt !== null || row.km <= model.lastKm + 0.05);
      const p = pointAtKm(points, row.km);
      let html: string;
      if (passed) {
        html = `<strong>${esc(row.name)}</strong><br>km ${Math.round(row.km)}<br>${passedAt ? `Passé à ${esc(when(new Date(passedAt), now))}` : "Passé (pas de pointage à ce contrôle)"}`;
      } else {
        const left = row.km - model.lastKm;
        const lines = [`<strong>${esc(row.name)}</strong>`, `km ${Math.round(row.km)} · dans ${esc(kmFmt(left))}`];
        if (model.startAt) {
          const open = new Date(model.startAt.getTime() + row.openMin * 60_000);
          const close = new Date(model.startAt.getTime() + row.closeMin * 60_000);
          lines.push(`Ouvert de ${esc(when(open, now))} à ${esc(when(close, now))}`);
        }
        if (model.avgKmh && model.last && model.status === "route") {
          lines.push(`Passage estimé vers ${esc(when(new Date(new Date(model.last.at).getTime() + (left / model.avgKmh) * 3_600_000), now))}`);
        }
        html = lines.join("<br>");
      }
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "", html: `<span class="lv-cp ${passed ? "is-done" : "is-next"}">${passed ? CHECK_SVG : i}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: row.name,
        keyboard: true,
      })
        .bindPopup(html)
        .addTo(layer);
    });

    // Position estimée (en route seulement).
    if (model.estimate) {
      const e = pointAtKm(points, model.estimate.km);
      L.circle([e.lat, e.lon], { radius: model.estimate.uncertaintyKm * 1000, color: accent, weight: 1.5, dashArray: "4 6", fillOpacity: 0.08 }).addTo(layer);
      L.marker([e.lat, e.lon], {
        icon: L.divIcon({ className: "", html: '<span class="lv-ghost" aria-hidden="true"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        title: "Position estimée",
        keyboard: true,
      })
        .bindPopup(
          `<strong>Position estimée</strong><br>vers le km ${Math.round(model.estimate.km)}${model.estimate.capped ? " (au prochain contrôle)" : ""}<br><em>D'après son rythme moyen : ce n'est pas une position réelle.</em>`,
        )
        .addTo(layer);
    }

    // Dernier pointage, par-dessus tout.
    if (model.last && model.status) {
      const at = model.last.lat !== null && model.last.lon !== null ? { lat: model.last.lat, lon: model.last.lon } : cut;
      const st = model.status;
      const msg = model.last.message ? `<br>« ${esc(model.last.message)} »` : "";
      L.marker([at.lat, at.lon], {
        icon: L.divIcon({ className: "", html: `<span class="lv-last is-${st}"><span class="lv-last-dot"></span></span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: "Dernier pointage",
        zIndexOffset: 1000,
        keyboard: true,
      })
        .bindPopup(
          `<strong>Dernier pointage</strong><br>${esc(model.lastPlace)} · km ${Math.round(model.lastKm)}<br>${esc(hhmm(new Date(model.last.at)))} · ${esc(CHECKIN_STATUS_LABEL[st])}${msg}`,
        )
        .addTo(layer);
      focusRef.current = L.latLng(at.lat, at.lon);
    } else focusRef.current = null;
  }, [points, model, now]);

  return (
    <div className="lv-map-wrap">
      <div ref={boxRef} className="lv-map" role="region" aria-label="Carte du parcours et des pointages" />
      {model.last && (
        <button type="button" className="lv-map-btn" onClick={() => focusRef.current && mapRef.current?.setView(focusRef.current, 12)}>
          <LocateFixed size={16} aria-hidden="true" /> Recentrer
        </button>
      )}
      <ul className="lv-legend" aria-label="Légende de la carte">
        <li><span className="lv-lg-done" /> Parcouru</li>
        <li><span className="lv-lg-rest" /> Restant</li>
        <li><span className="lv-cp is-done lv-lg-cp" dangerouslySetInnerHTML={{ __html: CHECK_SVG }} /> Contrôle passé</li>
        <li><span className="lv-cp is-next lv-lg-cp">1</span> Contrôle à venir</li>
        {model.estimate && <li><span className="lv-ghost lv-lg-ghost" /> Position estimée (pas réelle)</li>}
      </ul>
    </div>
  );
}
