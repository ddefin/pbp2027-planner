import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogEvent } from "../../api/brmCatalog";
import { buildMembers, GROUP_DISTANCES, todayIso } from "./model";

export type GroupView = "chrono" | "membres";

// Filtres de la section dans l'adresse (?dist=600&membre=…&passes=1&vue=membres) : un
// rechargement ou un lien partagé retrouve la même vue.
export function useGroupBrmFilters(events: CatalogEvent[] | null) {
  const [params, setParams] = useSearchParams();
  const distParam = Number(params.get("dist"));
  const dist = (GROUP_DISTANCES as readonly number[]).includes(distParam) ? distParam : null;
  const member = params.get("membre");
  const showPast = params.get("passes") === "1";
  const view: GroupView = params.get("vue") === "membres" ? "membres" : "chrono";

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const derived = useMemo(() => {
    const today = todayIso();
    const chosen = (events ?? []).filter((e) => e.participants.length > 0).sort((a, b) => a.date.localeCompare(b.date));
    const members = buildMembers(chosen);
    const selectedMember = members.find((m) => m.key === member) ?? null;
    const base = chosen.filter((e) => (dist === null || e.distance === dist) && (!selectedMember || e.participants.some((p) => p.memberKey === selectedMember.key)));
    const visible = showPast ? base : base.filter((e) => e.date >= today);
    const upcoming = chosen.filter((e) => e.date >= today);
    return {
      today,
      chosen,
      members,
      selectedMember,
      visible,
      hiddenPast: base.length - visible.length,
      stats: { distinct: chosen.length, next: upcoming[0] ?? null, riders: members.length },
    };
  }, [events, dist, member, showPast]);

  const filtered = dist !== null || member !== null || showPast;
  return {
    dist,
    member,
    showPast,
    view,
    filtered,
    ...derived,
    setDist: (d: number | null) => set({ dist: d === null ? null : String(d) }),
    setMember: (k: string | null) => set({ membre: k }),
    setShowPast: (v: boolean) => set({ passes: v ? "1" : null }),
    setView: (v: GroupView) => set({ vue: v === "chrono" ? null : v }),
    reset: () => set({ dist: null, membre: null, passes: null }),
  };
}
