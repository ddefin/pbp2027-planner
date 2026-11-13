import { fmtAgo } from "../format";
import type { Presence } from "../types";

// Présence : point de couleur + libellé écrit (jamais la couleur seule).
// Vert = en ligne (< 5 min) · orange = vu dans les 72 h · rouge = au-delà, ou jamais.
export function presenceLabel(presence: Presence, lastSeenAt: string | null): string {
  if (presence === "online") return "En ligne";
  if (!lastSeenAt) return "Jamais connecté";
  return presence === "recent" ? `Vu ${fmtAgo(lastSeenAt)}` : `Absent · ${fmtAgo(lastSeenAt)}`;
}

export function PresenceDot({ presence, lastSeenAt, compact }: { presence: Presence; lastSeenAt: string | null; compact?: boolean }) {
  const label = presenceLabel(presence, lastSeenAt);
  return (
    <span className={`ad-presence is-${presence}`} title={label}>
      <i aria-hidden="true" />
      {compact ? <span className="ad-sr">{label}</span> : <span>{label}</span>}
    </span>
  );
}
