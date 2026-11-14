import { Bike, Coffee, Flag, OctagonX } from "lucide-react";
import { CHECKIN_STATUS_LABEL, type CheckinStatus } from "../../lib/roadbook";

const ICON = { route: Bike, pause: Coffee, arrive: Flag, abandon: OctagonX } as const;

// Statut toujours écrit en toutes lettres (jamais la couleur seule).
export function StatusBadge({ status, small }: { status: CheckinStatus; small?: boolean }) {
  const Icon = ICON[status];
  return (
    <span className={`lv-badge is-${status}${small ? " is-small" : ""}`}>
      <Icon size={small ? 13 : 16} aria-hidden="true" />
      {CHECKIN_STATUS_LABEL[status]}
    </span>
  );
}
