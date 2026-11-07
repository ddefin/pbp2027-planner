import { useEffect, useState } from "react";
import { ApiError } from "../api/auth";
import { getMeteo, type CityWeather } from "../api/meteo";

export type MeteoStatus = "loading" | "ok" | "not_configured" | "unavailable" | "error";

export function useMeteo(brmEventId: string) {
  const [weather, setWeather] = useState<CityWeather | null>(null);
  const [status, setStatus] = useState<MeteoStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getMeteo(brmEventId)
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
  }, [brmEventId]);

  return { weather, status };
}
