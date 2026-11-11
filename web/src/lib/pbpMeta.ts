import type { ControlService, RouteKind, WeatherAlert, WindRelation } from "../api/pbpRoutes";

export const SERVICE_ICON: Record<ControlService, string> = {
  controle: "🚨",
  restauration: "🍴",
  douches: "🚿",
  couchage: "🛏️",
  mecanique: "⚙️",
};

export const SERVICE_LABEL: Record<ControlService, string> = {
  controle: "Contrôle",
  restauration: "Restauration",
  douches: "Douches",
  couchage: "Couchage",
  mecanique: "Mécanique",
};

export const KIND_LABEL: Record<RouteKind, string> = {
  officiel: "Officiel",
  provisoire: "Provisoire",
  communautaire: "Communautaire",
  indicatif: "Indicatif",
};

export const ALERT_LABEL: Record<WeatherAlert, string> = {
  vent_fort: "💨 Vent fort",
  vent_de_face: "⬅️ Vent de face",
  pluie: "🌧️ Pluie",
  froid: "🥶 Froid",
  chaleur: "🥵 Chaleur",
};

export const RELATION_LABEL: Record<WindRelation, string> = {
  face: "de face",
  dos: "de dos",
  travers: "de travers",
};

// Codes icônes OpenWeatherMap → emoji : pas d'image externe à charger (léger, et
// lisible hors-ligne une fois la page en cache).
export function weatherEmoji(icon: string): string {
  const code = icon.slice(0, 2);
  const night = icon.endsWith("n");
  switch (code) {
    case "01":
      return night ? "🌙" : "☀️";
    case "02":
      return night ? "☁️" : "🌤️";
    case "03":
    case "04":
      return "☁️";
    case "09":
      return "🌧️";
    case "10":
      return night ? "🌧️" : "🌦️";
    case "11":
      return "⛈️";
    case "13":
      return "❄️";
    case "50":
      return "🌫️";
    default:
      return "🌡️";
  }
}
