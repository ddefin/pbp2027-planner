import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Carte Leaflet minimale : juste le tracé (polyline), pas de marqueurs (évite le
// souci classique des icônes par défaut de Leaflet cassées par les bundlers).
// Leaflet manipule le DOM lui-même, donc instance impérative dans un useEffect
// plutôt qu'un rendu déclaratif React classique.
//
// Fond de carte CARTO plutôt que tile.openstreetmap.org : ce dernier a bloqué nos
// requêtes ("App is not following the tile usage policy") — leurs serveurs sont
// prévus pour du développement/usage ponctuel, pas pour être appelés directement
// par une app en production. CARTO fournit des fonds gratuits pensés pour cet
// usage, sans clé requise, avec une variante sombre assortie au thème de l'app.
export function TrackMap({ points }: { points: { lat: number; lon: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const map = L.map(containerRef.current, { attributionControl: true });
    mapRef.current = map;

    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const variant = dark ? "dark_all" : "light_all";
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 18,
      subdomains: "abcd",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

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
