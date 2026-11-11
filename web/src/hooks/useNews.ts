import { useCallback, useEffect, useState } from "react";
import { listNews, type NewsItem } from "../api/news";

// Charge tout une fois (même logique que useBrmCatalog) : filtres par source et
// recherche appliqués côté client dans NewsPage, pas de requête serveur à
// chaque frappe ni de debounce à gérer.
export function useNews() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await listNews();
      setItems(res.items);
      setLastUpdatedAt(res.lastUpdatedAt);
    } catch {
      setError("Impossible de charger les actualités.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, lastUpdatedAt, loading: items === null && !error, error, refresh };
}
