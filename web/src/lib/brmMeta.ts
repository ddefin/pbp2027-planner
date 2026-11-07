import type { BrmDistance, BrmStatus } from "../api/brm";

export const PBP_DATE = new Date("2027-08-17T05:00:00");

export const VALID_DISTANCES: BrmDistance[] = [200, 300, 400, 600];

export const STATUS_LABEL: Record<BrmStatus, string> = {
  "a-venir": "À venir",
  inscrit: "Inscrit",
  fait: "Fait",
  homologue: "Homologué",
};

export const STATUS_OPTIONS: BrmStatus[] = ["a-venir", "inscrit", "fait", "homologue"];

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}
