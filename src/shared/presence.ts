// Présence d'un membre d'après sa dernière activité (Session.lastSeenAt, rafraîchie à
// chaque requête ; un onglet ouvert interroge le serveur toutes les 60 s).
export type Presence = "online" | "recent" | "away";

export const ONLINE_MS = 5 * 60_000; // vert : vu depuis moins de 5 min
export const RECENT_MS = 72 * 3_600_000; // orange : vu depuis moins de 72 h ; rouge au-delà

export function presenceOf(lastSeenAt: Date | string | null | undefined, now: Date = new Date()): Presence {
  if (!lastSeenAt) return "away";
  const age = now.getTime() - new Date(lastSeenAt).getTime();
  if (age < ONLINE_MS) return "online";
  if (age < RECENT_MS) return "recent";
  return "away";
}
