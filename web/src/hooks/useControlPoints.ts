import { useCallback, useEffect, useState } from "react";
import {
  createControlPoint,
  deleteControlPoint,
  listControlPoints,
  type ControlPoint,
  type ControlPointKind,
} from "../api/brmCatalog";

export function useControlPoints(catalogEventId: string | null) {
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!catalogEventId) return;
    setLoading(true);
    try {
      setPoints(await listControlPoints(catalogEventId));
    } finally {
      setLoading(false);
    }
  }, [catalogEventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (data: { kind: ControlPointKind; label: string; lat: number; lon: number }) => {
      if (!catalogEventId) return;
      const point = await createControlPoint(catalogEventId, data);
      setPoints((prev) => [...prev, point]);
    },
    [catalogEventId],
  );

  const remove = useCallback(
    async (pointId: string) => {
      if (!catalogEventId) return;
      await deleteControlPoint(catalogEventId, pointId);
      setPoints((prev) => prev.filter((p) => p.id !== pointId));
    },
    [catalogEventId],
  );

  return { points, loading, add, remove };
}
