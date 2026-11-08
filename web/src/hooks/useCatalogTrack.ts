import { useCallback, useEffect, useState } from "react";
import { getCatalogTrack, uploadCatalogTrack, type CatalogTrack } from "../api/brmCatalog";

export function useCatalogTrack(catalogEventId: string | null) {
  const [track, setTrack] = useState<CatalogTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!catalogEventId) return;
    setLoading(true);
    setError(null);
    try {
      setTrack(await getCatalogTrack(catalogEventId));
    } catch {
      setError("Impossible de charger le tracé.");
    } finally {
      setLoading(false);
    }
  }, [catalogEventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      if (!catalogEventId) return;
      setError(null);
      try {
        setTrack(await uploadCatalogTrack(catalogEventId, file));
      } catch {
        setError("Échec de l'import — vérifie que c'est bien un fichier .gpx.");
      }
    },
    [catalogEventId],
  );

  return { track, loading, error, upload };
}
