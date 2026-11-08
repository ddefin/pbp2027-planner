import { prisma } from "../db.js";
import { config } from "../config.js";
import { fetchFranceBrmCatalog } from "./acpCatalog.js";
import { VALID_DISTANCES } from "./brm.js";
import { fetchCityWeather, type ForecastSlot } from "./openWeather.js";
import { triggerWebhooks } from "./webhooks.js";

// Horizon des prévisions gratuites OpenWeatherMap (voir src/lib/openWeather.ts) :
// inutile d'interroger le calendrier ACP plus loin, aucune prévision n'y
// répondrait de toute façon.
const FORECAST_HORIZON_DAYS = 5;
// Statuts qui valent "j'ai l'intention d'y aller" — "fait"/"homologue" sont du
// passé, pas concernés par une alerte météo à venir.
const UPCOMING_STATUSES = ["prevu", "inscrit"];

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function worstSlotForDate(forecast: ForecastSlot[], date: string): ForecastSlot | null {
  const slots = forecast.filter((s) => s.at.slice(0, 10) === date);
  if (slots.length === 0) return null;
  return slots.reduce((worst, s) => {
    const worstPeak = Math.max(worst.windSpeedKmh, worst.windGustsKmh ?? 0);
    const sPeak = Math.max(s.windSpeedKmh, s.windGustsKmh ?? 0);
    return sPeak > worstPeak ? s : worst;
  });
}

// Vérifie les BRM du calendrier ACP choisis par au moins un randonneur dans les
// prochains jours, et déclenche l'événement webhook "meteo.vent_fort" (une
// seule fois par BRM+jour de prévision, voir le modèle WindAlertSent) si le
// vent prévu dépasse le seuil configuré. Pensé pour être appelée
// périodiquement (voir le scheduler dans src/server.ts), pas par requête HTTP.
export async function checkWindAlerts(): Promise<void> {
  if (!config.openWeatherApiKey) return; // pas de météo configurée, rien à vérifier

  const from = toDateOnly(new Date());
  const to = toDateOnly(new Date(Date.now() + FORECAST_HORIZON_DAYS * 24 * 60 * 60 * 1000));

  let events;
  try {
    events = await fetchFranceBrmCatalog({ from, to, distances: VALID_DISTANCES });
  } catch {
    return; // catalogue ACP indisponible : on retentera au prochain passage
  }
  if (events.length === 0) return;

  const ids = events.map((e) => e.id);
  const participations = await prisma.brmParticipation.findMany({
    where: { catalogEventId: { in: ids }, status: { in: UPCOMING_STATUSES } },
    select: { catalogEventId: true },
  });
  const chosenIds = new Set(participations.map((p) => p.catalogEventId));
  const chosenEvents = events.filter((e) => chosenIds.has(e.id));

  for (const event of chosenEvents) {
    const weather = await fetchCityWeather(event.ville);
    if (!weather) continue;

    const worst = worstSlotForDate(weather.forecast, event.date);
    if (!worst) continue;

    const peakKmh = Math.max(worst.windSpeedKmh, worst.windGustsKmh ?? 0);
    if (peakKmh < config.windAlertThresholdKmh) continue;

    try {
      await prisma.windAlertSent.create({ data: { catalogEventId: event.id, forecastDate: event.date } });
    } catch {
      continue; // déjà alerté pour ce BRM et ce jour (contrainte unique) — rien à refaire
    }

    await triggerWebhooks("meteo.vent_fort", {
      ville: event.ville,
      distance: event.distance,
      date: event.date,
      windKmh: worst.windSpeedKmh,
      gustsKmh: worst.windGustsKmh,
      direction: worst.windDirection,
    });
  }
}
