import { useState } from "react";
import { Check, CircleDashed, ClipboardCheck, Flag } from "lucide-react";
import type { CatalogParticipant } from "../../api/brmCatalog";
import { CATALOG_STATUS_LABEL } from "../../lib/brmMeta";
import { STATUS_RANK } from "./model";
import { Avatar } from "../Avatar";

const ICON = { prevu: CircleDashed, inscrit: ClipboardCheck, fait: Flag, homologue: Check } as const;
const MAX = 4;
const label = (s: string) => CATALOG_STATUS_LABEL[s as keyof typeof CATALOG_STATUS_LABEL] ?? s;

// Pastilles d'initiales + statut (icône, infobulle et texte lisible au clavier). Au-delà de
// 4 participants, « +N » déplie la liste nominative.
export function ParticipantStack({ participants, highlight }: { participants: CatalogParticipant[]; highlight?: string | null }) {
  const [open, setOpen] = useState(false);
  const sorted = [...participants].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || a.displayName.localeCompare(b.displayName, "fr"));
  const shown = sorted.slice(0, MAX);
  const extra = sorted.length - shown.length;
  return (
    <div className="gb-people">
      <ul className="gb-avatars" aria-label={`${participants.length} participant${participants.length > 1 ? "s" : ""}`}>
        {shown.map((p, i) => {
          const Icon = ICON[p.status as keyof typeof ICON] ?? CircleDashed;
          return (
            <li key={`${p.memberKey}-${i}`} className={`gb-avatar is-${p.status}${p.mine ? " is-me" : ""}${highlight === p.memberKey ? " is-focus" : ""}`} title={`${p.displayName}${p.mine ? " (toi)" : ""} · ${label(p.status)}`}>
              <Avatar name={p.displayName} avatar={p.avatar} size={28} />
              <Icon size={11} className="gb-avatar-status" aria-hidden="true" />
              <span className="gb-sr">
                {p.displayName}
                {p.mine ? " (toi)" : ""}, {label(p.status)}
              </span>
            </li>
          );
        })}
        {extra > 0 && (
          <li>
            <button type="button" className="gb-more" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={open ? "Replier" : "Voir tous les participants"}>
              +{extra}
            </button>
          </li>
        )}
      </ul>
      {(open || (sorted.length <= 2 && sorted.length > 0)) && (
        <ul className="gb-names">
          {(open ? sorted : shown).map((p, i) => (
            <li key={`${p.memberKey}-n-${i}`} className={p.mine ? "is-me" : undefined}>
              {p.displayName}
              {p.mine ? " (toi)" : ""} <span className={`gb-st is-${p.status}`}>{label(p.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
