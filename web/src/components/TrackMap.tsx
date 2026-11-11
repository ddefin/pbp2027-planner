import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ControlPoint, TrackPoint } from "../api/brmCatalog";
import { bearing } from "../lib/gpxAnalysis";
import { addBaseLayers } from "../lib/mapLayers";

const CONTROL_POINT_SYMBOL: Record<ControlPoint["kind"], string> = {
  depart: "🏁",
  arrivee: "🏁",
  ravito: "🍊",
  controle: "📍",
};

// Palette distincte de TRACK_COLOR (le tracé de référence, toujours rouge) pour que
// les variantes comparées restent identifiables sans se confondre avec lui.
const VARIANT_COLORS = ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ec4899", "#14b8a6"];

// Couleur fixe et saturée plutôt que l'accent du thème (vert, trop proche des
// couleurs de terrain sur CyclOSM/satellite — peu visible). Avec un liseré clair
// dessous (la "casing" classique en cartographie) pour rester lisible sur n'importe
// quel fond, y compris les photos satellite sombres.
const TRACK_COLOR = "#ff3b30";
const TRACK_CASING = "#ffffff";

// Un repère et une flèche de sens tous les 10km (en distance réelle, pas un nombre
// fixe d'échantillons — sinon un trajet court très échantillonné se retrouve avec
// une flèche tous les kilomètres, illisible en zigzag continu).
const KM_MARK_INTERVAL = 10;
const ARROW_INTERVAL_KM = 10;

function kmMarkerIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background: var(--panel, #fff);
      color: var(--fg, #1b231c);
      border: 1px solid ${TRACK_COLOR};
      border-radius: 999px;
      font: 700 10px 'JetBrains Mono', monospace;
      padding: 1px 5px;
      white-space: nowrap;
      transform: translate(-50%, -50%);
    ">${label}</div>`,
    iconSize: [0, 0],
  });
}

function arrowIcon(bearingDeg: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 0; height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 9px solid ${TRACK_COLOR};
      transform: translate(-50%, -50%) rotate(${bearingDeg}deg);
      filter: drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);
    "></div>`,
    iconSize: [0, 0],
  });
}

// Carte Leaflet : tracé, flèches de sens, repères kilométriques, sélecteur de fond
// de carte. Pas de marqueurs de position par défaut de Leaflet (évite le souci
// classique de leurs icônes cassées par les bundlers) — tout ici est en divIcon
// dessiné à la main. Instance impérative dans un useEffect (Leaflet gère son propre
// DOM), pas un rendu déclaratif React classique.
//
// Fonds de carte : voir src/lib/mapLayers.ts (partagés avec la carte Parcours PBP).
export function TrackMap({
  points,
  highlight,
  controlPoints,
  onDeleteControlPoint,
  addControlPointMode,
  onMapClick,
  variants,
}: {
  points: TrackPoint[];
  highlight?: { lat: number; lon: number } | null;
  controlPoints?: ControlPoint[];
  onDeleteControlPoint?: (id: string) => void;
  addControlPointMode?: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  variants?: { id: string; label: string; points: TrackPoint[] }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const highlightMarkerRef = useRef<L.CircleMarker | null>(null);
  const controlLayerRef = useRef<L.LayerGroup | null>(null);
  const variantLayerRef = useRef<L.LayerGroup | null>(null);
  const onDeleteControlPointRef = useRef(onDeleteControlPoint);
  onDeleteControlPointRef.current = onDeleteControlPoint;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const map = L.map(containerRef.current, { attributionControl: true });
    mapRef.current = map;

    addBaseLayers(map);

    controlLayerRef.current = L.layerGroup().addTo(map);
    variantLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e) => onMapClickRef.current?.(e.latlng.lat, e.latlng.lng));

    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    L.polyline(latLngs, { color: TRACK_CASING, weight: 7, opacity: 0.9 }).addTo(map);
    const polyline = L.polyline(latLngs, { color: TRACK_COLOR, weight: 4 }).addTo(map);

    // Flèches de sens et repères kilométriques, tous les deux espacés par distance
    // réelle (pas par index d'échantillon).
    let nextArrow = 0;
    let nextMark = KM_MARK_INTERVAL;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.distKm >= nextArrow && i < points.length - 1) {
        L.marker([p.lat, p.lon], { icon: arrowIcon(bearing(p, points[i + 1])), interactive: false }).addTo(map);
        nextArrow += ARROW_INTERVAL_KM;
      }
      if (p.distKm >= nextMark) {
        L.marker([p.lat, p.lon], { icon: kmMarkerIcon(`${nextMark} km`), interactive: false }).addTo(map);
        nextMark += KM_MARK_INTERVAL;
      }
    }

    map.fitBounds(polyline.getBounds(), { padding: [16, 16] });

    return () => {
      map.remove();
      mapRef.current = null;
      highlightMarkerRef.current = null;
      controlLayerRef.current = null;
      variantLayerRef.current = null;
    };
  }, [points]);

  // Curseur en croix pendant le mode "ajouter un point" — juste un indice visuel,
  // le vrai comportement est le listener "click" posé une fois ci-dessus.
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.style.cursor = addControlPointMode ? "crosshair" : "";
  }, [addControlPointMode]);

  // Points de ravito/contrôle : effet séparé de celui qui construit la carte, pour
  // ne pas la reconstruire (et perdre le zoom/la position) à chaque ajout/suppression.
  useEffect(() => {
    const layer = controlLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const cp of controlPoints ?? []) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="font-size: 20px; transform: translate(-50%, -100%);">${CONTROL_POINT_SYMBOL[cp.kind]}</div>`,
        iconSize: [0, 0],
      });
      const marker = L.marker([cp.lat, cp.lon], { icon });
      const deleteBtn = cp.mine && onDeleteControlPointRef.current ? `<br/><button type="button" class="cp-delete-btn" style="margin-top:4px;">Supprimer</button>` : "";
      marker.bindPopup(`<b>${cp.label}</b>${deleteBtn}`);
      marker.on("popupopen", (e) => {
        const btn = e.popup.getElement()?.querySelector(".cp-delete-btn");
        btn?.addEventListener("click", () => {
          onDeleteControlPointRef.current?.(cp.id);
          marker.closePopup();
        });
      });
      marker.addTo(layer);
    }
  }, [controlPoints]);

  // Variantes de tracé en overlay, une couleur distincte chacune — juste la ligne,
  // sans flèches/repères (ça alourdirait trop la carte avec plusieurs variantes).
  useEffect(() => {
    const layer = variantLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    (variants ?? []).forEach((v, i) => {
      const color = VARIANT_COLORS[i % VARIANT_COLORS.length];
      L.polyline(v.points.map((p) => L.latLng(p.lat, p.lon)), { color, weight: 3, dashArray: "6 6" })
        .bindTooltip(v.label)
        .addTo(layer);
    });
  }, [variants]);

  // Effet séparé (pas dans celui ci-dessus) : la position survolée sur le profil
  // change à chaque mouvement de souris — recréer toute la carte à ce rythme serait
  // coûteux et ferait clignoter les tuiles. On déplace juste un marqueur existant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!highlight) {
      if (highlightMarkerRef.current) {
        highlightMarkerRef.current.remove();
        highlightMarkerRef.current = null;
      }
      return;
    }

    if (highlightMarkerRef.current) {
      highlightMarkerRef.current.setLatLng([highlight.lat, highlight.lon]);
    } else {
      highlightMarkerRef.current = L.circleMarker([highlight.lat, highlight.lon], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: TRACK_COLOR,
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
  }, [highlight]);

  if (points.length < 2) return null;

  return <div ref={containerRef} style={{ height: 360, borderRadius: 10, overflow: "hidden" }} />;
}
