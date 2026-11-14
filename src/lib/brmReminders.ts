import { prisma } from "../db.js";
import { fetchFranceBrmCatalog, type AcpCatalogEvent } from "./acpCatalog.js";
import { CALENDAR_DISTANCES, CATALOG_FROM, CATALOG_TO } from "./brm.js";
import { notifyUser } from "./notify.js";
import { fetchCityWeather } from "./openWeather.js";
import { parisParts } from "./coachReports.js";

// Rappels avant un BRM choisi sur le calendrier : à J-7 et la veille, dans la cloche (et
// sur Telegram si le compte est lié). Une seule fois par randonneur, BRM et échéance
// (modèle BrmReminder). Seuls les choix « Prévu » et « Inscrit » sont rappelés.

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Prévision la plus proche de 7 h (heure de Paris) le jour du brevet, si elle existe déjà
// (l'API gratuite ne voit qu'à 5 jours : utile à J-1, pas à J-7).
async function departureWeather(city: string, date: string): Promise<string | null> {
  const w = await fetchCityWeather(city).catch(() => null);
  if (!w) return null;
  const sameDay = w.forecast.filter((s) => parisParts(new Date(s.at)).date === date);
  if (sameDay.length === 0) return null;
  const slot = sameDay.reduce((best, s) => (Math.abs(parisParts(new Date(s.at)).hour - 7) < Math.abs(parisParts(new Date(best.at)).hour - 7) ? s : best));
  const rain = Math.round(slot.precipitationProbability * 100);
  return `${Math.round(slot.tempC)}°, ${slot.description}, vent ${slot.windSpeedKmh} km/h ${slot.windDirection}${rain >= 30 ? `, pluie ${rain} %` : ""}`;
}

export async function reminderText(e: AcpCatalogEvent, kind: "j7" | "j1"): Promise<string> {
  const what = `BRM ${e.distance} km à ${e.ville}`;
  if (kind === "j7") return `🚴 J-7 : ${what}, ${longDate(e.date)}. Vérifie ton inscription, ton vélo et tes éclairages.`;
  const weather = await departureWeather(e.ville, e.date);
  return `🚴 Demain : ${what}.${weather ? ` Météo vers 7 h : ${weather}.` : ""} Éclairages chargés, gilet, carte de route, de quoi manger. Bonne route !`;
}

// Lancé toutes les heures. Envoie à partir de 7 h (heure de Paris), pas en pleine nuit.
export async function sendBrmReminders(now = new Date()): Promise<number> {
  const { date: today, hour } = parisParts(now);
  if (hour < 7) return 0;
  const targets: Record<string, "j7" | "j1"> = { [addDays(today, 7)]: "j7", [addDays(today, 1)]: "j1" };

  let events: AcpCatalogEvent[];
  try {
    events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES });
  } catch {
    return 0; // calendrier ACP indisponible : on réessaie à l'heure suivante
  }
  const due = events.filter((e) => targets[e.date]);
  if (due.length === 0) return 0;

  const participations = await prisma.brmParticipation.findMany({
    where: { catalogEventId: { in: due.map((e) => e.id) }, status: { in: ["prevu", "inscrit"] }, user: { suspendedAt: null, isSystem: false } },
    select: { userId: true, catalogEventId: true },
  });
  let sent = 0;
  for (const p of participations) {
    const event = due.find((e) => e.id === p.catalogEventId)!;
    const kind = targets[event.date];
    // La ligne d'abord (contrainte d'unicité) : deux passages simultanés n'envoient qu'une fois.
    try {
      await prisma.brmReminder.create({ data: { userId: p.userId, catalogEventId: event.id, kind } });
    } catch {
      continue; // déjà envoyé
    }
    await notifyUser(p.userId, "brm_reminder", await reminderText(event, kind), "/calendrier").catch((err) => console.error("[rappels] envoi impossible :", err));
    sent++;
  }
  return sent;
}
