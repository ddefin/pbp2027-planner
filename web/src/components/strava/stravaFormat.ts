export const activityUrl = (id: string) => `https://www.strava.com/activities/${encodeURIComponent(id)}`;
export const segmentUrl = (id: string) => `https://www.strava.com/segments/${encodeURIComponent(id)}`;

export function frDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { ...opts, timeZone: "UTC" });
}

export function monthLabel(ym: string): string {
  const s = new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function chrono(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Durées en heures et minutes (« 21 h 36 », « 45 min », « 3 h ») plutôt qu'en heures
// décimales (« 21,6 h »), et leur version lue par VoiceOver (« 21 heures 36 minutes »).
function splitHours(hours: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(hours * 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

export function hoursMinutes(hours: number): string {
  const { h, m } = splitHours(hours);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function hoursMinutesSpoken(hours: number): string {
  const { h, m } = splitHours(hours);
  const hh = `${h} heure${h > 1 ? "s" : ""}`;
  const mm = `${m} minute${m > 1 ? "s" : ""}`;
  if (h === 0) return mm;
  return m ? `${hh} ${mm}` : hh;
}
