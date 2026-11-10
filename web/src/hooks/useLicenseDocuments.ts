import { useCallback, useEffect, useState } from "react";
import {
  deleteLicenseDocument,
  listLicenseDocuments,
  uploadLicenseDocument,
  type LicenseDocument,
} from "../api/profile";

export function useLicenseDocuments() {
  const [documents, setDocuments] = useState<LicenseDocument[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDocuments(await listLicenseDocuments());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(async (file: File) => {
    setError(null);
    try {
      const doc = await uploadLicenseDocument(file);
      // La plus récente (createdAt desc) devient "la courante" : en tête de liste.
      setDocuments((prev) => [doc, ...(prev ?? [])]);
    } catch {
      setError("Échec de l'import — vérifie que c'est bien un PDF, PNG ou JPEG (10 Mo max).");
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteLicenseDocument(id);
    setDocuments((prev) => (prev ?? []).filter((d) => d.id !== id));
  }, []);

  return { documents, loading, error, upload, remove };
}
