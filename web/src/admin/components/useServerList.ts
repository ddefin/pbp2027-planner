import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorText } from "../api";
import type { Page } from "../types";

// État d'une liste paginée côté serveur, gardé dans l'adresse (?q=&page=&taille=&…).
export function useServerList<T>(fetcher: (p: URLSearchParams) => Promise<Page<T>>, extra: string[] = [], deps: unknown[] = []) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = [10, 20, 50, 100].includes(Number(params.get("taille"))) ? Number(params.get("taille")) : 20;
  const extras = Object.fromEntries(extra.map((k) => [k, params.get(k) ?? ""]));
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const extrasKey = JSON.stringify(extras);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
    for (const [k, v] of Object.entries(JSON.parse(extrasKey) as Record<string, string>)) if (v) p.set(k, v);
    fetcher(p)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page, pageSize, extrasKey, tick, ...deps]);

  const update = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage) next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return { q, page, pageSize, extras, data, loading, error, update, reload: () => setTick((t) => t + 1) };
}

// Champ de recherche instantanée relié à ?q= (légère temporisation).
export function useDebouncedSearch(q: string, update: (p: Record<string, string | null>) => void) {
  const [value, setValue] = useState(q);
  useEffect(() => setValue(q), [q]);
  useEffect(() => {
    if (value === q) return;
    const t = setTimeout(() => update({ q: value.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [value, q, update]);
  return [value, setValue] as const;
}
