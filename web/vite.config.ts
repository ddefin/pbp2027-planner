import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, le front (5173) et l'API (3001) sont deux origines distinctes :
// le proxy évite le CORS et garde les requêtes same-origin pour le cookie de session.
// En prod, même logique via le reverse proxy (voir web/README.md).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
