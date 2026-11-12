import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

// Nouvelle version déployée : le service worker s'active tout de suite, puis la page se
// recharge pour l'utiliser. Pour ne pas couper quelqu'un en plein usage (carte ouverte en
// brevet, formulaire en cours), le rechargement attend que l'onglet passe en arrière-plan
// ou le prochain changement de page (voir App.tsx) ; s'il est déjà caché, c'est immédiat.
registerSW({
  immediate: true,
  onNeedReload() {
    if (document.visibilityState === "hidden") return window.location.reload();
    window.__pbpUpdateReady = true;
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && window.location.reload(), { once: false });
  },
  onRegisteredSW(_url, registration) {
    // Vérifie s'il existe une nouvelle version au retour sur l'onglet et toutes les 30 min
    // (une appli installée peut rester ouverte des jours).
    if (!registration) return;
    const check = () => void registration.update().catch(() => undefined);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    setInterval(check, 30 * 60_000);
  },
});

declare global {
  interface Window {
    __pbpUpdateReady?: boolean;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
