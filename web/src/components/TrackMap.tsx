import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Carte Leaflet minimale : le tracé (polyline) plus un sélecteur de fond de carte,
// pas de marqueurs (évite le souci classique des icônes par défaut de Leaflet
// cassées par les bundlers). Leaflet manipule le DOM lui-même, donc instance
// impérative dans un useEffect plutôt qu'un rendu déclaratif React classique.
//
// Plusieurs fonds au choix plutôt qu'un seul imposé : tile.openstreetmap.org
// bloquait nos requêtes, CARTO exige désormais une clé API sur ses fonds gratuits,
// OpenTopoMap puis CyclOSM seuls se sont révélés peu lisibles selon les cas (et
// inverser les couleurs de CyclOSM en mode sombre rendait la carte illisible —
// abandonné). On laisse maintenant choisir : Vélo (CyclOSM), Satellite (Esri, sans
// clé) et Relief (OpenTopoMap), toutes affichées dans leurs couleurs réelles.
export function TrackMap({ points }: { points: { lat: number; lon: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

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

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1f5c3f";
    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    const polyline = L.polyline(latLngs, { color: accent, weight: 4 }).addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [16, 16] });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (points.length < 2) return null;

  return <div ref={containerRef} style={{ height: 360, borderRadius: 10, overflow: "hidden" }} />;
}
