import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// En dev, le front (5173) et l'API (3001) sont deux origines distinctes :
// le proxy évite le CORS et garde les requêtes same-origin pour le cookie de session.
// Toutes les routes backend sont sous /api (voir src/server.ts) pour ne jamais entrer
// en collision avec une route côté client (ex. /messagerie existe des deux côtés).
// En prod, même logique via le reverse proxy (voir web/README.md).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Enregistré à la main dans main.tsx (registerSW) plutôt que par le script
      // auto-injecté par défaut — évite un double enregistrement du service worker.
      injectRegister: false,
      // L'app a besoin du réseau pour l'essentiel (connexion, messagerie temps réel,
      // météo) — l'objectif ici n'est pas un vrai mode déconnecté, juste que la carte
      // et le profil d'élévation d'un BRM déjà consultés restent utilisables avec un
      // réseau mobile capricieux en plein brevet, sans réinstaller l'app.
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        runtimeCaching: [
          {
            // Fonds de carte CyclOSM/Esri/OpenTopoMap (voir TrackMap.tsx) : une fois
            // une zone affichée, ses tuiles restent utilisables hors-ligne.
            urlPattern: /^https:\/\/.*(tile-cyclosm\.openstreetmap\.fr|arcgisonline\.com|tile\.opentopomap\.org)\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tracé/stats d'un BRM déjà consulté : rejoué hors-ligne tel quel, mais une
            // connexion dispo prend toujours le pas (pas de tracé périmé affiché par erreur).
            urlPattern: /\/api\/brm\/catalog\/[^/]+\/(track|track-variants|control-points|meteo)$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "brm-track-data",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "PBP2027 Planner",
        short_name: "PBP2027",
        description: "Organisation collective pour la qualification et le départ du Paris-Brest-Paris 2027.",
        theme_color: "#0f2a4f",
        background_color: "#0f2a4f",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
