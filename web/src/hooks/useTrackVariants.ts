import { useCallback, useEffect, useState } from "react";
import { deleteTrackVariant, listTrackVariants, uploadTrackVariant, type TrackVariant } from "../api/brmCatalog";

export function useTrackVariants(catalogEventId: string | null) {
  const [variants, setVariants] = useState<TrackVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!catalogEventId) return;
    setLoading(true);
    try {
      setVariants(await listTrackVariants(catalogEventId));
    } finally {
      setLoading(false);
    }
  }, [catalogEventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File, label: string) => {
      if (!catalogEventId) return;
      setError(null);
      try {
        const variant = await uploadTrackVariant(catalogEventId, file, label);
        setVariants((prev) => [...prev, variant]);
      } catch {
        setError("Échec de l'import — vérifie que c'est bien un fichier .gpx.");
      }
    },
    [catalogEventId],
  );

  const remove = useCallback(
    async (variantId: string) => {
      if (!catalogEventId) return;
      await deleteTrackVariant(catalogEventId, variantId);
      setVariants((prev) => prev.filter((v) => v.id !== variantId));
    },
    [catalogEventId],
  );

  return { variants, loading, error, upload, remove };
}
