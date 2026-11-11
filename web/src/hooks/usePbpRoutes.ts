import { useCallback, useEffect, useState } from "react";
import {
  deletePbpRoute,
  getPbpMeta,
  getPbpRoute,
  listPbpRoutes,
  updatePbpRoute,
  uploadPbpRoute,
  type PbpMeta,
  type PbpRouteDetail,
  type PbpRouteMeta,
  type RouteKind,
} from "../api/pbpRoutes";

// Tracés du parcours PBP. Le détail (points) n'est chargé que pour les tracés
// effectivement affichés — principal + comparaisons — et gardé en mémoire le temps
// de la page : repasser d'un tracé à l'autre ne refait pas la requête.
export function usePbpRoutes() {
  const [meta, setMeta] = useState<PbpMeta | null>(null);
  const [routes, setRoutes] = useState<PbpRouteMeta[] | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, PbpRouteDetail>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async (selectDefault = false) => {
    try {
      const res = await listPbpRoutes();
      setRoutes(res.routes);
      setPrimaryId((prev) => (selectDefault || !prev || !res.routes.some((r) => r.id === prev) ? res.defaultId : prev));
    } catch {
      setError("Impossible de charger les tracés.");
    }
  }, []);

  useEffect(() => {
    getPbpMeta().then(setMeta).catch(() => setError("Impossible de charger les informations du parcours."));
    refreshList(true);
  }, [refreshList]);

  const wanted = [primaryId, ...compareIds].filter((id): id is string => Boolean(id));
  const wantedKey = wanted.join(",");
  useEffect(() => {
    for (const id of wanted) {
      if (details[id]) continue;
      getPbpRoute(id)
        .then((d) => setDetails((prev) => ({ ...prev, [id]: d })))
        .catch(() => setError("Impossible de charger ce tracé."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectPrimary = useCallback((id: string) => {
    setPrimaryId(id);
    setCompareIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const upload = useCallback(
    async (input: { file: File; label: string; kind: RouteKind }) => {
      const res = await uploadPbpRoute(input);
      await refreshList();
      setPrimaryId(res.route.id); // on montre tout de suite ce qu'on vient d'importer
    },
    [refreshList],
  );

  const changeKind = useCallback(
    async (id: string, kind: RouteKind) => {
      await updatePbpRoute(id, { kind });
      await refreshList();
    },
    [refreshList],
  );

  const remove = useCallback(
    async (id: string) => {
      await deletePbpRoute(id);
      setCompareIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDetails((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      await refreshList(primaryId === id);
    },
    [refreshList, primaryId],
  );

  return {
    meta,
    routes,
    primaryId,
    primary: primaryId ? (details[primaryId] ?? null) : null,
    primaryMeta: routes?.find((r) => r.id === primaryId) ?? null,
    compareIds,
    compare: [...compareIds]
      .filter((id) => details[id])
      .map((id) => ({ id, label: routes?.find((r) => r.id === id)?.label ?? id, points: details[id].points })),
    error,
    selectPrimary,
    toggleCompare,
    upload,
    changeKind,
    remove,
  };
}
