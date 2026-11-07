import { config } from "../config.js";

const CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather";
const FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";
const CACHE_TTL_MS = 15 * 60 * 1000; // la météo ne vaut pas la peine d'un appel à chaque chargement de page
const FETCH_TIMEOUT_MS = 8000;

export interface CurrentWeather {
  tempC: number;
  feelsLikeC: number;
  description: string;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  windDirection: string; // "N", "NE", ... dérivé de wind.deg
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
  precipitationProbability: number; // 0-1
}

export interface CityWeather {
  city: string;
  current: CurrentWeather;
  forecast: ForecastSlot[]; // jusqu'à 5 jours, pas de 3h (limite de l'API gratuite)
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

function degToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

function msToKmh(ms: number): number {
  return Math.round(ms * 3.6);
}

const cache = new Map<string, { expiresAt: number; data: CityWeather }>();

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCityWeather(city: string): Promise<CityWeather | null> {
  if (!config.openWeatherApiKey) return null;

  const key = city.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const query = `q=${encodeURIComponent(city)},FR&appid=${config.openWeatherApiKey}&units=metric&lang=fr`;

  let currentRaw: Record<string, unknown>;
  let forecastRaw: Record<string, unknown>;
  try {
    [currentRaw, forecastRaw] = await Promise.all([fetchJson(`${CURRENT_URL}?${query}`), fetchJson(`${FORECAST_URL}?${query}`)]);
  } catch {
    return null;
  }

  const currentMain = currentRaw.main as Record<string, number> | undefined;
  const currentWind = currentRaw.wind as Record<string, number> | undefined;
  const currentWeatherArr = currentRaw.weather as { description: string }[] | undefined;
  if (!currentMain || !currentWind || !currentWeatherArr?.[0]) return null;

  const current: CurrentWeather = {
    tempC: Math.round(currentMain.temp),
    feelsLikeC: Math.round(currentMain.feels_like),
    description: currentWeatherArr[0].description,
    windSpeedKmh: msToKmh(currentWind.speed),
    windGustsKmh: typeof currentWind.gust === "number" ? msToKmh(currentWind.gust) : null,
    windDirection: typeof currentWind.deg === "number" ? degToCompass(currentWind.deg) : "—",
    humidity: currentMain.humidity,
    observedAt: new Date(((currentRaw.dt as number) ?? Date.now() / 1000) * 1000).toISOString(),
  };

  const forecastList = (forecastRaw.list as Record<string, unknown>[] | undefined) ?? [];
  const forecast: ForecastSlot[] = forecastList.map((slot) => {
    const main = slot.main as Record<string, number>;
    const wind = slot.wind as Record<string, number>;
    const weatherArr = slot.weather as { description: string }[];
    return {
      at: new Date((slot.dt as number) * 1000).toISOString(),
      tempC: Math.round(main.temp),
      description: weatherArr?.[0]?.description ?? "",
      windSpeedKmh: msToKmh(wind.speed),
      windGustsKmh: typeof wind.gust === "number" ? msToKmh(wind.gust) : null,
      windDirection: typeof wind.deg === "number" ? degToCompass(wind.deg) : "—",
      precipitationProbability: typeof slot.pop === "number" ? slot.pop : 0,
    };
  });

  const data: CityWeather = { city: (currentRaw.name as string) || city, current, forecast };
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}
