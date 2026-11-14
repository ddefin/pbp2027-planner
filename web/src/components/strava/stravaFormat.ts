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
