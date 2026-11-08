import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

// updateViaCache: pas de autoUpdate silencieux en plein usage (ex. pendant qu'un
// randonneur consulte sa carte en brevet) — recharge seulement au prochain chargement
// de page, comme n'importe quelle mise à jour web classique.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
