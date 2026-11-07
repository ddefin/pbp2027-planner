import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, le front (5173) et l'API (3001) sont deux origines distinctes :
// le proxy évite le CORS et garde les requêtes same-origin pour le cookie de session.
// Toutes les routes backend sont sous /api (voir src/server.ts) pour ne jamais entrer
// en collision avec une route côté client (ex. /sorties existe des deux côtés).
// En prod, même logique via le reverse proxy (voir web/README.md).
export default defineConfig({
  plugins: [react()],
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
