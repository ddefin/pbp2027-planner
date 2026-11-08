import type { BrmDistance, BrmStatus } from "../api/brm";

// Départs donnés par créneaux successifs : date officielle retenue pour le
// compte à rebours en attendant la répartition définitive des créneaux.
export const PBP_DATE = new Date("2027-08-22T16:00:00");

export const VALID_DISTANCES: BrmDistance[] = [200, 300, 400, 600];

// Repli quand le calendrier ACP ne fournit pas de site propre à l'événement (ex.
// certains BRM organisés directement par l'Audax Club Parisien plutôt que par un
// club affilié) : la page calendrier officielle, d'où viennent ces données.
export const ACP_CALENDAR_URL = "https://www.audax-club-parisien.com/organisation/brm-monde/";

export const STATUS_LABEL: Record<BrmStatus, string> = {
  "a-venir": "À venir",
  inscrit: "Inscrit",
  fait: "Fait",
  homologue: "Homologué",
};

export const STATUS_OPTIONS: BrmStatus[] = ["a-venir", "inscrit", "fait", "homologue"];

export const CATALOG_STATUS_OPTIONS = ["prevu", "inscrit", "fait", "homologue"] as const;
export type CatalogStatus = (typeof CATALOG_STATUS_OPTIONS)[number];

export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = {
  prevu: "Prévu",
  inscrit: "Inscrit",
  fait: "Fait",
  homologue: "Homologué",
};

// Jours restants jusqu'à une date "yyyy-mm-dd", arrondi au jour près (pas de ticking
// temps réel ici, contrairement à Countdown — utilisé pour un J-N dans une liste).
export function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}
