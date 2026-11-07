import { useCallback, useEffect, useState } from "react";
import {
  deleteParcoursFile,
  getParcours,
  updateParcours,
  uploadParcoursFile,
  type Parcours,
  type ParcoursUpdateInput,
} from "../api/parcours";

export function useParcours(brmEventId: string) {
  const [parcours, setParcours] = useState<Parcours | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setParcours(await getParcours(brmEventId));
    } catch {
      setError("Impossible de charger le parcours.");
    }
  }, [brmEventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: ParcoursUpdateInput) => {
      const result = await updateParcours(brmEventId, input);
      setParcours(result.parcours);
      return result.autoFetched;
    },
    [brmEventId],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const result = await uploadParcoursFile(brmEventId, file);
      setParcours(result.parcours);
      return result.statsParsed;
    },
    [brmEventId],
  );

  const removeFile = useCallback(async () => {
    await deleteParcoursFile(brmEventId);
    await refresh();
  }, [brmEventId, refresh]);

  return { parcours, loading: parcours === undefined && !error, error, refresh, save, uploadFile, removeFile };
}
