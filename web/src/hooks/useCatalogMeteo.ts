import { useEffect, useState } from "react";
import { ApiError } from "../api/auth";
import { getCatalogMeteo, type CityWeather } from "../api/meteo";
import type { MeteoStatus } from "./useMeteo";

// Miroir de useMeteo, pour un BRM du calendrier ACP plutôt qu'un BRM saisi
// manuellement (voir src/routes/brmCatalog.ts côté serveur).
export function useCatalogMeteo(catalogEventId: string | null) {
  const [weather, setWeather] = useState<CityWeather | null>(null);
  const [status, setStatus] = useState<MeteoStatus>("loading");

  useEffect(() => {
    if (!catalogEventId) return;
    let cancelled = false;
    setStatus("loading");
    getCatalogMeteo(catalogEventId)
      .then((w) => {
        if (cancelled) return;
        setWeather(w);
        setStatus("ok");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "not_configured") setStatus("not_configured");
        else if (err instanceof ApiError && err.code === "meteo_unavailable") setStatus("unavailable");
        else setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [catalogEventId]);

  return { weather, status };
}
