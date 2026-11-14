import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogEvent } from "../../api/brmCatalog";
import { GROUP_DISTANCES, todayIso } from "./model";

// Filtres du calendrier dans l'adresse (?dist=600&region=…&q=…&mes=1&passes=1) : un
// rechargement retrouve la même liste.
export function useCalendarFilters(events: CatalogEvent[] | null) {
  const [params, setParams] = useSearchParams();
  const distParam = Number(params.get("dist"));
  const dist = (GROUP_DISTANCES as readonly number[]).includes(distParam) ? distParam : null;
  const region = params.get("region") ?? "";
  const search = params.get("q") ?? "";
  const mineOnly = params.get("mes") === "1";
  const showPast = params.get("passes") === "1";

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
    const all = [...(events ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const regions = [...new Set(all.map((e) => e.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    const term = search.trim().toLowerCase();
    const base = all.filter(
      (e) =>
        (dist === null || e.distance === dist) &&
        (!region || e.region === region) &&
        (!mineOnly || e.myStatus !== null) &&
        (!term || `${e.ville} ${e.club} ${e.departement}`.toLowerCase().includes(term)),
    );
    const visible = showPast ? base : base.filter((e) => e.date >= today);
    const mine = all.filter((e) => e.myStatus !== null);
    return {
      today,
      regions,
      visible,
      hiddenPast: base.length - visible.length,
      stats: {
        total: all.filter((e) => e.date >= today).length,
        mine: mine.length,
        next: mine.find((e) => e.date >= today) ?? null,
      },
    };
  }, [events, dist, region, search, mineOnly, showPast]);

  return {
    dist,
    region,
    search,
    mineOnly,
    showPast,
    filtered: dist !== null || region !== "" || search !== "" || mineOnly || showPast,
    ...derived,
    setDist: (d: number | null) => set({ dist: d === null ? null : String(d) }),
    setRegion: (r: string) => set({ region: r }),
    setSearch: (q: string) => set({ q }),
    setMineOnly: (v: boolean) => set({ mes: v ? "1" : null }),
    setShowPast: (v: boolean) => set({ passes: v ? "1" : null }),
    reset: () => set({ dist: null, region: null, q: null, mes: null, passes: null }),
  };
}
