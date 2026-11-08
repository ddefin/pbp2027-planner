import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Les tests WebSocket (chat, messagerie) attendent une livraison en temps réel ;
    // sous charge (plusieurs fichiers de test lancés en parallèle, chacun démarrant
    // son propre serveur Fastify), 5s (le défaut de vitest) peut ne pas suffire sans
    // que ce soit un bug applicatif.
    testTimeout: 15000,
  },
});
