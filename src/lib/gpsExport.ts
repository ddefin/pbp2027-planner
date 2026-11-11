import { escapeHtml } from "./telegram.js";
import { buildSchedule, classifyPoi, formatMinutes, type PacingSettings, type RoadbookControl, type ScheduleRow } from "../shared/roadbookCalc.js";
import type { RoutePoint } from "./geo.js";

// Export du roadbook pour un compteur GPS : le tracé + les contrôles (avec heures
// d'ouverture/fermeture) + les points d'eau/ravito. GPX pour Garmin/Wahoo/Hammerhead/
// Karoo ; TCX « Course » pour l'import de parcours dans Garmin Connect, avec des
// points de parcours (alerte sur le compteur à l'approche).

export interface ExportInput {
  title: string;
  startAt: Date | null;
  settings: PacingSettings;
  controls: RoadbookControl[];
  pois: { name: string; km: number; lat: number; lon: number }[];
  points: RoutePoint[];
}

const xml = escapeHtml;
const hhmm = (d: Date) => d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function controlNote(r: ScheduleRow, startAt: Date | null): string {
  const parts = [`km ${Math.round(r.km)}`];
  if (startAt) {
    parts.push(`ouvre ${hhmm(new Date(startAt.getTime() + r.openMin * 60_000))}`);
    parts.push(`ferme ${hhmm(new Date(startAt.getTime() + r.closeMin * 60_000))}`);
    parts.push(`prévu ${hhmm(new Date(startAt.getTime() + r.arriveMin * 60_000))}`);
  } else {
    parts.push(`arrivée prévue +${formatMinutes(r.arriveMin)}`, `ferme +${formatMinutes(r.closeMin)}`);
  }
  return parts.join(" · ");
}

export function buildGpx(i: ExportInput): string {
  const schedule = buildSchedule(i.controls, i.points, i.settings);
  const byKm = new Map(i.controls.map((c) => [Math.round(c.km * 10), c]));
  const wpts: string[] = [];
  for (const r of schedule) {
    const c = byKm.get(Math.round(r.km * 10));
    if (c?.lat === undefined || c?.lon === undefined || c.lat === null || c.lon === null) continue;
    wpts.push(`  <wpt lat="${c.lat}" lon="${c.lon}"><name>${xml(r.name)}</name><desc>${xml(controlNote(r, i.startAt))}</desc><sym>Flag, Blue</sym><type>controle</type></wpt>`);
  }
  for (const p of i.pois) {
    const kind = classifyPoi(p.name);
    wpts.push(`  <wpt lat="${p.lat}" lon="${p.lon}"><name>${xml(p.name)}</name><desc>km ${Math.round(p.km)}</desc><sym>${kind === "eau" ? "Drinking Water" : kind === "ravito" ? "Restaurant" : "Waypoint"}</sym><type>${kind ?? "poi"}</type></wpt>`);
  }
  const trk = i.points.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : ""}</trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PBP 2027 Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(i.title)}</name></metadata>
${wpts.join("\n")}
  <trk><name>${xml(i.title)}</name><trkseg>
${trk}
  </trkseg></trk>
</gpx>
`;
}

// Nom de point de parcours : les compteurs tronquent à 10 caractères.
const cpName = (n: string) => n.replace(/[^\p{L}\p{N} .-]/gu, "").trim().slice(0, 10) || "Point";

export function buildTcx(i: ExportInput): string {
  const schedule = buildSchedule(i.controls, i.points, i.settings);
  const base = i.startAt ?? new Date("2027-01-01T06:00:00Z");
  const iso = (min: number) => new Date(base.getTime() + min * 60_000).toISOString();
  const total = i.points.length ? i.points[i.points.length - 1].distKm : 0;
  const timeAtKm = (km: number) => {
    const row = [...schedule].reverse().find((r) => r.km <= km) ?? schedule[0];
    const next = schedule.find((r) => r.km > km);
    if (!row || !next || next.km === row.km) return row?.departMin ?? 0;
    return row.departMin + ((next.arriveMin - row.departMin) * (km - row.km)) / (next.km - row.km);
  };
  const tp = i.points
    .map(
      (p) =>
        `        <Trackpoint><Time>${iso(timeAtKm(p.distKm))}</Time><Position><LatitudeDegrees>${p.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(6)}</LongitudeDegrees></Position>${p.ele !== null ? `<AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>` : ""}<DistanceMeters>${Math.round(p.distKm * 1000)}</DistanceMeters></Trackpoint>`,
    )
    .join("\n");
  const cps: string[] = [];
  const point = (name: string, km: number, lat: number, lon: number, type: string, notes: string) =>
    cps.push(
      `    <CoursePoint><Name>${xml(cpName(name))}</Name><Time>${iso(timeAtKm(km))}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position><PointType>${type}</PointType><Notes>${xml(notes)}</Notes></CoursePoint>`,
    );
  const byKm = new Map(i.controls.map((c) => [Math.round(c.km * 10), c]));
  for (const r of schedule) {
    const c = byKm.get(Math.round(r.km * 10));
    if (c?.lat === undefined || c?.lat === null || c.lon === undefined || c.lon === null) continue;
    point(r.name, r.km, c.lat, c.lon, "Generic", `${r.name} — ${controlNote(r, i.startAt)}`);
  }
  for (const p of i.pois) {
    const kind = classifyPoi(p.name);
    if (kind) point(p.name, p.km, p.lat, p.lon, kind === "eau" ? "Water" : "Food", `${p.name} — km ${Math.round(p.km)}`);
  }
  cps.sort();
  const name = xml(i.title.slice(0, 15));
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Courses><Course>
    <Name>${name}</Name>
    <Lap><TotalTimeSeconds>${Math.round((schedule[schedule.length - 1]?.arriveMin ?? 0) * 60)}</TotalTimeSeconds><DistanceMeters>${Math.round(total * 1000)}</DistanceMeters><BeginPosition><LatitudeDegrees>${i.points[0]?.lat ?? 0}</LatitudeDegrees><LongitudeDegrees>${i.points[0]?.lon ?? 0}</LongitudeDegrees></BeginPosition><EndPosition><LatitudeDegrees>${i.points[i.points.length - 1]?.lat ?? 0}</LatitudeDegrees><LongitudeDegrees>${i.points[i.points.length - 1]?.lon ?? 0}</LongitudeDegrees></EndPosition><Intensity>Active</Intensity></Lap>
    <Track>
${tp}
    </Track>
${cps.join("\n")}
  </Course></Courses>
</TrainingCenterDatabase>
`;
}
