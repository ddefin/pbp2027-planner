import { useCallback, useEffect, useState } from "react";
import { createSortie, joinSortie, leaveSortie, listSorties, type Sortie } from "../api/sorties";

export function useSorties() {
  const [sorties, setSorties] = useState<Sortie[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSorties(await listSorties());
    } catch {
      setError("Impossible de charger les sorties.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (input: { titre: string; date: string; lieu: string }) => {
    const sortie = await createSortie(input);
    setSorties((prev) => [...(prev ?? []), sortie].sort((a, b) => a.date.localeCompare(b.date)));
    return sortie;
  }, []);

  const toggleJoin = useCallback(async (id: string, joined: boolean) => {
    if (joined) await leaveSortie(id);
    else await joinSortie(id);
    await refresh();
  }, [refresh]);

  return { sorties, loading: sorties === null && !error, error, refresh, create, toggleJoin };
}
