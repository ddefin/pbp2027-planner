import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Carte Leaflet/OpenStreetMap minimale : juste le tracé (polyline), pas de marqueurs
// (évite le souci classique des icônes par défaut de Leaflet cassées par les
// bundlers). Leaflet manipule le DOM lui-même, donc instance impérative dans un
// useEffect plutôt qu'un rendu déclaratif React classique.
export function TrackMap({ points }: { points: { lat: number; lon: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const map = L.map(containerRef.current, { attributionControl: true });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    const polyline = L.polyline(latLngs, { color: "#e8683c", weight: 4 }).addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [16, 16] });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (points.length < 2) return null;

  return <div ref={containerRef} style={{ height: 360, borderRadius: 10, overflow: "hidden" }} />;
}
