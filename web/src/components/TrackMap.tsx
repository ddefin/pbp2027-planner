import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint } from "../api/brmCatalog";
import { bearing } from "../lib/gpxAnalysis";

// Couleur fixe et saturée plutôt que l'accent du thème (vert, trop proche des
// couleurs de terrain sur CyclOSM/satellite — peu visible). Avec un liseré clair
// dessous (la "casing" classique en cartographie) pour rester lisible sur n'importe
// quel fond, y compris les photos satellite sombres.
const TRACK_COLOR = "#ff3b30";
const TRACK_CASING = "#ffffff";

// Un repère tous les 10km, et une flèche de sens tous les ~12 échantillons (assez
// pour voir le sens du parcours sans surcharger la carte — "discret" comme demandé).
const KM_MARK_INTERVAL = 10;
const ARROW_SAMPLE_STRIDE = 12;

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
// Plusieurs fonds au choix : tile.openstreetmap.org bloquait nos requêtes, CARTO
// exige désormais une clé API sur ses fonds gratuits, OpenTopoMap puis CyclOSM seuls
// se sont révélés peu lisibles selon les cas. Vélo (CyclOSM), Satellite (Esri, sans
// clé) et Relief (OpenTopoMap), dans leurs couleurs réelles.
export function TrackMap({ points, highlight }: { points: TrackPoint[]; highlight?: { lat: number; lon: number } | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const highlightMarkerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const map = L.map(containerRef.current, { attributionControl: true });
    mapRef.current = map;

    const velo = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: "abc",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | © <a href="https://www.cyclosm.org">CyclOSM</a>',
    });
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri — World Imagery" },
    );
    const relief = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: "abc",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    });
    velo.addTo(map);
    L.control.layers({ "Vélo": velo, "Satellite": satellite, "Relief": relief }).addTo(map);

    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    L.polyline(latLngs, { color: TRACK_CASING, weight: 7, opacity: 0.9 }).addTo(map);
    const polyline = L.polyline(latLngs, { color: TRACK_COLOR, weight: 4 }).addTo(map);

    // Flèches de sens du parcours.
    for (let i = 0; i < points.length - 1; i += ARROW_SAMPLE_STRIDE) {
      const a = points[i];
      const b = points[Math.min(i + 1, points.length - 1)];
      L.marker([a.lat, a.lon], { icon: arrowIcon(bearing(a, b)), interactive: false }).addTo(map);
    }

    // Repères tous les 10km.
    let nextMark = KM_MARK_INTERVAL;
    for (const p of points) {
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
    };
  }, [points]);

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
