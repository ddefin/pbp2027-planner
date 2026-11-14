import type { CatalogEvent } from "../../api/brmCatalog";
import type { AvatarData } from "../../api/auth";
import { QUALIFYING_STEPS, stepFor } from "../../../../src/shared/qualification";

export const GROUP_DISTANCES = [200, 300, 400, 600, 1000] as const;
export const STATUS_RANK: Record<string, number> = { prevu: 1, inscrit: 2, fait: 3, homologue: 4 };

export interface Member {
  key: string;
  name: string; // prénom, suffixé d'un numéro si deux randonneurs portent le même
  mine: boolean;
  avatar?: AvatarData;
  entries: { event: CatalogEvent; status: string }[];
}

export type StepState = { step: number; status: string | null; via: number | null };

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Randonneurs du groupe à partir des choix sur le calendrier. Deux homonymes sont
// distingués par `memberKey` (identifiant opaque fourni par le serveur).
export function buildMembers(events: CatalogEvent[]): Member[] {
  const map = new Map<string, Member>();
  for (const e of events) {
    for (const p of e.participants) {
      const m = map.get(p.memberKey) ?? { key: p.memberKey, name: p.displayName, mine: p.mine, avatar: p.avatar, entries: [] };
      m.entries.push({ event: e, status: p.status });
      map.set(p.memberKey, m);
    }
  }
  const list = [...map.values()].sort((a, b) => (a.mine === b.mine ? a.name.localeCompare(b.name, "fr") : a.mine ? -1 : 1));
  const seen = new Map<string, number>();
  for (const m of list) {
    const n = (seen.get(m.name) ?? 0) + 1;
    seen.set(m.name, n);
    if (n > 1) m.name = `${m.name} (${n})`;
  }
  for (const m of list) m.entries.sort((a, b) => a.event.date.localeCompare(b.event.date));
  return list;
}

// Étapes de qualification d'un randonneur : le meilleur statut obtenu pour chaque étape
// (un 1000 vaut pour le 600, même règle que le compteur du tableau de bord).
export function memberSteps(m: Member): StepState[] {
  return QUALIFYING_STEPS.map((step) => {
    let best: { status: string; distance: number } | null = null;
    for (const { event, status } of m.entries) {
      if (stepFor(event.distance) !== step) continue;
      if (!best || (STATUS_RANK[status] ?? 0) > (STATUS_RANK[best.status] ?? 0)) best = { status, distance: event.distance };
    }
    return { step, status: best?.status ?? null, via: best && best.distance !== step ? best.distance : null };
  });
}

export const monthLabel = (iso: string) => {
  const s = new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
