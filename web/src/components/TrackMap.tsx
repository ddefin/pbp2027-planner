import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Carte Leaflet minimale : juste le tracé (polyline), pas de marqueurs (évite le
// souci classique des icônes par défaut de Leaflet cassées par les bundlers).
// Leaflet manipule le DOM lui-même, donc instance impérative dans un useEffect
// plutôt qu'un rendu déclaratif React classique.
//
// Fond de carte OpenTopoMap : tile.openstreetmap.org a bloqué nos requêtes ("App is
// not following the tile usage policy" — pas prévu pour une app en production), et
// CARTO (essayé ensuite) exige désormais une clé API sur ses fonds gratuits.
// OpenTopoMap reste accessible sans clé et son usage policy encourage justement ce
// genre d'intégration externe à volume modéré. Pas de variante sombre officielle :
// en mode sombre, un filtre CSS inverse les tuiles (technique standard pour donner
// un rendu nocturne à un fond de carte qui n'en propose pas).
export function TrackMap({ points }: { points: { lat: number; lon: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const map = L.map(containerRef.current, { attributionControl: true });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: "abc",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }).addTo(map);

    // Le filtre s'applique uniquement aux tuiles (pas au conteneur entier) : sinon il
    // inverserait aussi la couleur du tracé tracé par-dessus.
    if (dark) {
      const tilePane = map.getPane("tilePane");
      if (tilePane) tilePane.style.filter = "invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)";
    }

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
