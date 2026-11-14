import type { Checkin, LiveView, SharedRoadbook } from "../../api/roadbooks";
import { buildSchedule, controlPassages, controlWindow, estimatedKm, gainBetween, type CheckinStatus, type ScheduleRow } from "../../lib/roadbook";

// Tout ce que la page des proches déduit des pointages : une seule source pour l'en-tête,
// la carte, la progression et le journal.

export interface LiveModel {
  totalKm: number;
  last: Checkin | null;
  status: CheckinStatus | null; // null : pas encore de pointage
  lastKm: number;
  lastPlace: string; // « Fougères », « Contrôle de Loudéac » ou « km 412 »
  avgKmh: number | null; // pauses comprises, depuis le départ
  gainDone: number | null;
  gainLeft: number | null;
  schedule: ScheduleRow[];
  passages: (string | null)[]; // heure réelle de passage, par contrôle (même ordre que schedule)
  next: { row: ScheduleRow; kmLeft: number; etaMin: Date | null; etaMax: Date | null; openAt: Date | null; closeAt: Date | null } | null;
  estimate: { km: number; uncertaintyKm: number; capped: boolean } | null;
  startAt: Date | null;
}

const NEAR_CONTROL_KM = 2;

export function placeFor(km: number, schedule: ScheduleRow[], serverPlace: string | null): string {
  const near = schedule.find((r) => Math.abs(r.km - km) <= NEAR_CONTROL_KM);
  if (near) return near.name;
  if (serverPlace) return serverPlace;
  return `km ${Math.round(km)}`;
}

export function buildModel(rb: SharedRoadbook, checkins: Checkin[], live: LiveView | null, now: Date): LiveModel {
  const totalKm = rb.points[rb.points.length - 1]?.distKm ?? rb.distanceKm;
  const schedule = buildSchedule(rb.controls, rb.points, {
    movingSpeedKmh: rb.movingSpeedKmh,
    climbPenaltyMinPer100m: rb.climbPenaltyMinPer100m,
    classKm: rb.classKm,
    limitMinutes: rb.limitMinutes,
  });
  const last = checkins[0] ?? null;
  const lastKm = last?.km ?? 0;
  const startAt = rb.startAt ? new Date(rb.startAt) : null;
  const status: CheckinStatus | null = !last ? null : last.status === "route" && lastKm >= totalKm - 0.05 ? "arrive" : last.status;
  const elapsedH = last && startAt ? (new Date(last.at).getTime() - startAt.getTime()) / 3_600_000 : null;
  const avgKmh = elapsedH && elapsedH > 0.1 && lastKm > 0 ? lastKm / elapsedH : null;

  const nextRow = status === "route" || status === "pause" ? schedule.find((r) => r.km > lastKm + 0.05) ?? null : null;
  let next: LiveModel["next"] = null;
  if (nextRow && last) {
    const kmLeft = nextRow.km - lastKm;
    const paceEta = avgKmh ? new Date(new Date(last.at).getTime() + (kmLeft / avgKmh) * 3_600_000) : null;
    const planEta = live?.nextControl && Math.abs(live.nextControl.km - nextRow.km) < 0.1 && live.nextControl.eta ? new Date(live.nextControl.eta) : null;
    const etas = [paceEta, planEta].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
    const w = controlWindow(nextRow.km, rb.classKm, rb.limitMinutes);
    next = {
      row: nextRow,
      kmLeft,
      etaMin: etas[0] ?? null,
      etaMax: etas[etas.length - 1] ?? null,
      openAt: startAt ? new Date(startAt.getTime() + w.openMin * 60_000) : null,
      closeAt: startAt ? new Date(startAt.getTime() + w.closeMin * 60_000) : null,
    };
  }

  return {
    totalKm,
    last,
    status,
    lastKm,
    lastPlace: last ? placeFor(lastKm, schedule, live && live.checkinAt === last.at ? live.place : null) : "",
    avgKmh,
    gainDone: last ? gainBetween(rb.points, 0, lastKm) : 0,
    gainLeft: gainBetween(rb.points, lastKm, totalKm),
    schedule,
    passages: controlPassages(schedule, checkins),
    next,
    estimate:
      last && status
        ? estimatedKm({ lastKm, lastAt: last.at, avgKmh, now, totalKm, nextControlKm: nextRow?.km ?? null, status })
        : null,
    startAt,
  };
}

// ─── Formats (fr, heure du navigateur) ───

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function hhmm(d: Date): string {
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
}

export function when(d: Date, now: Date): string {
  if (sameDay(d, now)) return hhmm(d);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
  return `${day} ${hhmm(d)}`;
}

export function duration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

export function ago(iso: string, now: Date): string {
  const min = (now.getTime() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return "à l'instant";
  return `il y a ${duration(min)}`;
}

export const km = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: n < 10 ? 1 : 0 })} km`;
export const meters = (n: number | null) => (n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} m`);
