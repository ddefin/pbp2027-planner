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
      // Le calendrier ACP source liste parfois deux fois le même brevet (entrée
      // strictement identique côté ACP) — même id stable des deux côtés (voir
      // stableId() dans src/lib/acpCatalog.ts). Sans dédoublonnage, deux éléments
      // de liste React partagent la même key, ce qui corrompt la réconciliation
      // du DOM dès qu'un filtre change la taille de la liste (des BRM d'autres
      // régions se mettaient à apparaître dans une région filtrée).
      const seen = new Set<string>();
      const deduped = res.events.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      setEvents(deduped);
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
      // Les autres participants sont repérés par `mine` (pas par le prénom : deux homonymes).
      setEvents((prev) => {
        const list = prev ?? [];
        const myKey = list.flatMap((e) => e.participants).find((p) => p.mine)?.memberKey ?? "moi";
        return list.map((e) => {
          if (e.id !== id) return e;
          const others = e.participants.filter((p) => !p.mine);
          return { ...e, myStatus: status, participants: [...others, { displayName: publicNameOf(user?.prenom), status, mine: true, memberKey: myKey, avatar: user?.avatar }] };
        });
      });
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
            ? { ...e, myStatus: null, participants: e.participants.filter((p) => !p.mine) }
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
