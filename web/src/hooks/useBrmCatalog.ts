import { useCallback, useEffect, useState } from "react";
import { clearParticipation, listCatalog, setParticipation, type CatalogEvent } from "../api/brmCatalog";
import { useAuth } from "../context/AuthContext";

function publicNameOf(prenom: string | undefined): string {
  return prenom ?? "Moi";
}

export function useBrmCatalog() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CatalogEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await listCatalog();
      setEvents(res.events);
    } catch {
      setError("Impossible de charger le calendrier des BRM.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const choose = useCallback(
    async (id: string, status: string) => {
      // Mise à jour optimiste : l'UI répond tout de suite, on resynchronise sur erreur.
      setEvents((prev) =>
        (prev ?? []).map((e) => {
          if (e.id !== id) return e;
          const others = e.participants.filter((p) => p.displayName !== publicNameOf(user?.prenom));
          return { ...e, myStatus: status, participants: [...others, { displayName: publicNameOf(user?.prenom), status }] };
        }),
      );
      try {
        await setParticipation(id, status);
      } catch {
        await refresh();
      }
    },
    [user, refresh],
  );

  const clear = useCallback(
    async (id: string) => {
      setEvents((prev) =>
        (prev ?? []).map((e) =>
          e.id === id
            ? { ...e, myStatus: null, participants: e.participants.filter((p) => p.displayName !== publicNameOf(user?.prenom)) }
            : e,
        ),
      );
      try {
        await clearParticipation(id);
      } catch {
        await refresh();
      }
    },
    [user, refresh],
  );

  return { events, loading: events === null && !error, error, refresh, choose, clear };
}
