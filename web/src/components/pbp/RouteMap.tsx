import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint } from "../../api/brmCatalog";
import type { PbpControl, RouteWaypoint, RouteWeatherSample } from "../../api/pbpRoutes";
import { addBaseLayers } from "../../lib/mapLayers";
import { bearing } from "../../lib/gpxAnalysis";
import { nearestIndex, pointAtKm } from "../../lib/routeMath";
import { SERVICE_ICON } from "../../lib/pbpMeta";

const PRIMARY_COLOR = "#ff3b30";
const COMPARE_COLORS = ["#2563eb", "#a855f7", "#f59e0b", "#10b981", "#ec4899"];
const RELATION_COLOR = { face: "#dc2626", dos: "#16a34a", travers: "#d97706" } as const;
// Sur 1200 km, un repère tous les 10 km (comme les cartes de BRM) ferait 120
// étiquettes superposées au zoom d'ensemble : 50 km reste lisible sur un téléphone.
const KM_MARK_INTERVAL = 50;
const ARROW_INTERVAL_KM = 25;

function divIcon(html: string): L.DivIcon {
  return L.divIcon({ className: "", html, iconSize: [0, 0] });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface CompareRoute {
  id: string;
  label: string;
  points: TrackPoint[];
}

// Carte du parcours PBP. Instance Leaflet impérative créée une seule fois ; chaque
// couche (tracé principal, comparaisons, contrôles, météo, curseur, position) vit
// dans son propre effet, pour ne jamais reconstruire toute la carte (et perdre le
// zoom) quand seul le curseur bouge. preferCanvas : les tracés sont dessinés dans un
// unique <canvas> plutôt qu'en SVG — sur mobile, un polyligne de plusieurs milliers
// de points en SVG alourdit nettement le DOM et le défilement.
export function RouteMap({
  points,
  indicative,
  compare,
  controls,
  waypoints,
  weather,
  cursorKm,
  userPosition,
  onSelectKm,
}: {
  points: TrackPoint[];
  indicative: boolean;
  compare: CompareRoute[];
  controls: PbpControl[];
  waypoints: RouteWaypoint[];
  weather: RouteWeatherSample[];
  cursorKm: number | null;
  userPosition: { lat: number; lon: number } | null;
  onSelectKm: (km: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.LayerGroup>>({});
  const cursorRef = useRef<L.CircleMarker | null>(null);
  const userRef = useRef<L.CircleMarker | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const onSelectKmRef = useRef(onSelectKm);
  onSelectKmRef.current = onSelectKm;
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    // zoomSnap fractionnaire : le parcours est très allongé (Brest ↔ Paris), un zoom
    // entier laisse soit déborder le tracé, soit beaucoup de vide autour sur mobile.
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true, zoomSnap: 0.25 });
    mapRef.current = map;
    for (const name of ["compare", "primary", "weather", "controls", "waypoints"]) layers.current[name] = L.layerGroup().addTo(map);
    addBaseLayers(map, "Plan IGN", { "Météo (vent)": layers.current.weather, "Contrôles": layers.current.controls, "Points du GPX": layers.current.waypoints });
    // Vue d'ensemble : les étiquettes de vent et de km se chevauchent et masquent le
    // tracé (surtout sur un écran de téléphone) — masquées sous ce zoom, la frise
    // météo sous la carte donne déjà la même information.
    const updateZoomClass = () => containerRef.current?.classList.toggle("rm-zoom-low", map.getZoom() < 7);
    map.on("zoomend", updateZoomClass);
    map.setView([48.4, -1.3], 7);
    updateZoomClass();
    return () => {
      map.remove();
      mapRef.current = null;
      layers.current = {};
      cursorRef.current = null;
      userRef.current = null;
    };
  }, []);

  // Tracé principal : redessiné (et recadré) seulement quand on change de tracé.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layers.current.primary;
    if (!map || !layer) return;
    layer.clearLayers();
    if (points.length < 2) return;

    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    if (indicative) {
      // Pas une route : pointillés gris, pour qu'on ne le confonde jamais avec un itinéraire.
      L.polyline(latLngs, { color: "#475569", weight: 3, dashArray: "2 8", lineCap: "round" }).addTo(layer);
    } else {
      L.polyline(latLngs, { color: "#ffffff", weight: 7, opacity: 0.9, interactive: false }).addTo(layer);
      const line = L.polyline(latLngs, { color: PRIMARY_COLOR, weight: 4 }).addTo(layer);
      line.on("click", (e: L.LeafletMouseEvent) => {
        const idx = nearestIndex(pointsRef.current, { lat: e.latlng.lat, lon: e.latlng.lng });
        onSelectKmRef.current(pointsRef.current[idx].distKm);
      });

      let nextArrow = ARROW_INTERVAL_KM / 2;
      let nextMark = KM_MARK_INTERVAL;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        if (p.distKm >= nextArrow) {
          const b = bearing(p, points[Math.min(points.length - 1, i + 3)]);
          L.marker([p.lat, p.lon], {
            icon: divIcon(`<div class="rm-arrow" style="transform: translate(-50%, -50%) rotate(${b}deg)"></div>`),
            interactive: false,
          }).addTo(layer);
          nextArrow += ARROW_INTERVAL_KM;
        }
        if (p.distKm >= nextMark) {
          L.marker([p.lat, p.lon], { icon: divIcon(`<div class="rm-km">${nextMark}</div>`), interactive: false }).addTo(layer);
          nextMark += KM_MARK_INTERVAL;
        }
      }
    }
    map.fitBounds(L.latLngBounds(latLngs), { padding: [20, 20] });
  }, [points, indicative]);

  useEffect(() => {
    const layer = layers.current.compare;
    if (!layer) return;
    layer.clearLayers();
    compare.forEach((r, i) => {
      L.polyline(
        r.points.map((p) => L.latLng(p.lat, p.lon)),
        { color: COMPARE_COLORS[i % COMPARE_COLORS.length], weight: 3, dashArray: "8 6", opacity: 0.85 },
      )
        .bindTooltip(escapeHtml(r.label), { sticky: true })
        .addTo(layer);
    });
  }, [compare]);

  useEffect(() => {
    const layer = layers.current.controls;
    if (!layer) return;
    layer.clearLayers();
    // Une ville visitée à l'aller et au retour = un seul marqueur avec les deux
    // passages, plutôt que deux marqueurs exactement superposés.
    const byPlace = new Map<string, PbpControl[]>();
    for (const c of controls) {
      const key = `${c.lat},${c.lon}`;
      byPlace.set(key, [...(byPlace.get(key) ?? []), c]);
    }
    for (const group of byPlace.values()) {
      const c = group[0];
      const isControl = group.some((g) => g.services.includes("controle"));
      const label = group.map((g) => g.step).join("/");
      const marker = L.marker([c.lat, c.lon], {
        icon: divIcon(`<div class="rm-ctrl${isControl ? "" : " rm-ctrl-accueil"}">${label}</div>`),
      });
      const passages = group
        .map((g) => {
          const km = g.km === null ? "hors tracé" : `km ${g.km.toLocaleString("fr-FR")}`;
          const services = g.services.map((s) => SERVICE_ICON[s]).join(" ");
          const note = g.note ? `<br/><i>${escapeHtml(g.note)}</i>` : "";
          return `Étape ${g.step} · ${km} ${services}${note}`;
        })
        .join("<br/>");
      marker.bindPopup(`<b>${escapeHtml(c.name.replace(/ \((départ|arrivée)\)/, ""))}</b><br/>${passages}`);
      marker.on("click", () => {
        const first = group.find((g) => g.km !== null);
        if (first?.km != null) onSelectKmRef.current(first.km);
      });
      marker.addTo(layer);
    }
  }, [controls]);

  useEffect(() => {
    const layer = layers.current.waypoints;
    if (!layer) return;
    layer.clearLayers();
    for (const w of waypoints) {
      L.circleMarker([w.lat, w.lon], { radius: 5, color: "#0f172a", weight: 2, fillColor: "#facc15", fillOpacity: 1 })
        .bindTooltip(`${escapeHtml(w.name)} · km ${w.km}`)
        .addTo(layer);
    }
  }, [waypoints]);

  // Flèches de vent le long du tracé : pointent là où le vent SOUFFLE (pas d'où il
  // vient), colorées selon qu'il est de face / de dos / de travers pour le cycliste.
  useEffect(() => {
    const layer = layers.current.weather;
    if (!layer) return;
    layer.clearLayers();
    for (const s of weather) {
      const f = s.forecast;
      if (!f || f.windFromDeg === null) continue;
      const color = f.windRelation ? RELATION_COLOR[f.windRelation] : "#334155";
      const marker = L.marker([s.lat, s.lon], {
        icon: divIcon(
          `<div class="rm-wind" style="--wc:${color}"><span style="transform: rotate(${(f.windFromDeg + 180) % 360}deg)">➤</span>${f.windSpeedKmh}</div>`,
        ),
      });
      marker.on("click", () => onSelectKmRef.current(s.km));
      marker.addTo(layer);
    }
  }, [weather]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (cursorKm === null || points.length < 2) {
      cursorRef.current?.remove();
      cursorRef.current = null;
      return;
    }
    const p = pointAtKm(points, cursorKm);
    if (cursorRef.current) cursorRef.current.setLatLng([p.lat, p.lon]);
    else
      cursorRef.current = L.circleMarker([p.lat, p.lon], {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
  }, [cursorKm, points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userRef.current?.remove();
    userRef.current = null;
    if (!userPosition) return;
    userRef.current = L.circleMarker([userPosition.lat, userPosition.lon], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#16a34a",
      fillOpacity: 1,
    })
      .bindTooltip("Ma position")
      .addTo(map);
    map.setView([userPosition.lat, userPosition.lon], Math.max(map.getZoom(), 11));
  }, [userPosition]);

  // Plein écran : API Fullscreen quand elle existe sur un élément quelconque, sinon
  // (Safari iPhone, qui ne la permet que pour les vidéos) repli CSS en position fixe.
  async function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    if (!fullscreen) {
      if (el.requestFullscreen) {
        try {
          await el.requestFullscreen();
        } catch {
          // refusé : le repli CSS ci-dessous suffit
        }
      }
      setFullscreen(true);
    } else {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
    }
  }

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    // La taille du conteneur vient de changer : Leaflet doit recalculer ses tuiles,
    // et on recadre sur le tracé pour profiter de la place gagnée (ou perdue).
    const t = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      const pts = pointsRef.current;
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => L.latLng(p.lat, p.lon))), { padding: [20, 20] });
    }, 150);
    return () => clearTimeout(t);
  }, [fullscreen]);

  return (
    <div ref={wrapRef} className={`route-map-wrap${fullscreen ? " is-fullscreen" : ""}`}>
      <div ref={containerRef} className="route-map" />
      <button type="button" className="route-map-fs" onClick={toggleFullscreen} aria-label={fullscreen ? "Quitter le plein écran" : "Plein écran"}>
        {fullscreen ? "✕" : "⛶"}
      </button>
    </div>
  );
}
