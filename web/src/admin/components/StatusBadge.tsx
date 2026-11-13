import { Ban, CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import type { UserStatus } from "../types";

const MAP = {
  active: { label: "Actif", icon: CheckCircle2 },
  suspended: { label: "Suspendu", icon: Ban },
  locked: { label: "Verrouillé", icon: Lock },
} as const;

// Statut = icône + libellé + couleur (jamais la couleur seule).
export function StatusBadge({ status }: { status: UserStatus }) {
  const { label, icon: Icon } = MAP[status];
  return (
    <span className={`ad-badge is-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

export function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return isAdmin ? (
    <span className="ad-badge is-admin">
      <ShieldCheck size={13} aria-hidden="true" />
      Admin
    </span>
  ) : (
    <span className="ad-badge is-member">Membre</span>
  );
}
