import { ApiError } from "./auth";

export interface CurrentWeather {
  tempC: number;
  feelsLikeC: number;
  description: string;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  windDirection: string;
  humidity: number;
  observedAt: string;
}

export interface ForecastSlot {
  at: string;
  tempC: number;
  description: string;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  windDirection: string;
  precipitationProbability: number;
}

export interface CityWeather {
  city: string;
  current: CurrentWeather;
  forecast: ForecastSlot[];
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export function getMeteo(brmEventId: string) {
  return request<{ weather: CityWeather }>(`/brm/${brmEventId}/meteo`).then((r) => r.weather);
}
