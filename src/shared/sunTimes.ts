// Lever et coucher du soleil (algorithme simplifié de la NOAA, précision ~1 min en France),
// sans appel réseau : utilisé pour « tombée de la nuit » sur la page de suivi des proches.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// Pour le jour UTC contenant `date` : heures de lever et de coucher (null en jour ou nuit polaires).
export function sunTimes(lat: number, lon: number, date: Date): { sunrise: Date | null; sunset: Date | null } {
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.floor((dayStart - Date.UTC(2000, 0, 1, 12)) / 86_400_000) + 1; // jours depuis J2000
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545 + jStar + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lambda));
  const decl = Math.asin(Math.sin(rad(lambda)) * Math.sin(rad(23.4397)));
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return { sunrise: null, sunset: null };
  const H = deg(Math.acos(cosH));
  const toDate = (j: number) => new Date((j - 2440587.5) * 86_400_000);
  return { sunrise: toDate(jTransit - H / 360), sunset: toDate(jTransit + H / 360) };
}

// Prochain changement jour/nuit après `now` à cet endroit.
export function daylight(lat: number, lon: number, now: Date): { isNight: boolean; nextChange: Date | null; sunset: Date | null; sunrise: Date | null } {
  const today = sunTimes(lat, lon, now);
  const tomorrow = sunTimes(lat, lon, new Date(now.getTime() + 86_400_000));
  const t = now.getTime();
  if (!today.sunrise || !today.sunset) return { isNight: false, nextChange: null, sunset: null, sunrise: null };
  if (t < today.sunrise.getTime()) return { isNight: true, nextChange: today.sunrise, sunset: today.sunset, sunrise: today.sunrise };
  if (t < today.sunset.getTime()) return { isNight: false, nextChange: today.sunset, sunset: today.sunset, sunrise: today.sunrise };
  return { isNight: true, nextChange: tomorrow.sunrise, sunset: today.sunset, sunrise: tomorrow.sunrise };
}
