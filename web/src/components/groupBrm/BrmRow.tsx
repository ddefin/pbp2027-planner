import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Mountain } from "lucide-react";
import type { CatalogEvent } from "../../api/brmCatalog";
import { ACP_CALENDAR_URL, daysUntil } from "../../lib/brmMeta";
import { DistanceBadge } from "./DistanceBadge";
import { ParticipantStack } from "./ParticipantStack";
import { MeteoToggle, TrackToggle } from "./brmToggles";
import { dayLabel } from "./model";

// Un BRM : carte compacte sur mobile, ligne de grille sur desktop (même balisage).
// « Détails » déplie liens, météo et carte (chargées seulement à la demande).
export function BrmRow({
  event,
  highlight,
  past,
  action,
}: {
  event: CatalogEvent;
  highlight?: string | null;
  past: boolean;
  action?: ReactNode; // calendrier : choix de mon statut
}) {
  const [open, setOpen] = useState(false);
  const j = daysUntil(event.date);
  const detailsId = `gb-det-${event.id}`;
  return (
    <li className={`gb-row${past ? " is-past" : ""}${event.myStatus ? " is-mine" : ""}${action ? " has-action" : ""}`}>
      <div className="gb-c-date">
        <strong>{dayLabel(event.date)}</strong>
        <span className="gb-j">{past ? "passé" : j === 0 ? "aujourd'hui" : `J-${j}`}</span>
      </div>
      <div className="gb-c-dist">
        <DistanceBadge distance={event.distance} />
      </div>
      <div className="gb-c-place">
        <strong>{event.ville}</strong>
        <span>
          {event.club}
          {event.departement ? ` · ${event.departement}` : ""}
        </span>
      </div>
      <div className="gb-c-elev">
        {event.denivele > 0 ? (
          <span title="Dénivelé positif annoncé">
            <Mountain size={13} aria-hidden="true" /> {event.denivele.toLocaleString("fr-FR")} m
          </span>
        ) : (
          <span className="gb-muted">—</span>
        )}
      </div>
      <div className={`gb-c-people${event.participants.length === 0 ? " is-empty" : ""}`}>
        <ParticipantStack participants={event.participants} highlight={highlight} />
      </div>
      {action && <div className="gb-c-action">{action}</div>}
      <div className="gb-c-more">
        <button type="button" className="gb-details-btn" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
          Détails <ChevronDown size={15} aria-hidden="true" className={open ? "is-open" : undefined} />
        </button>
      </div>
      {open && (
        <div className="gb-details" id={detailsId}>
          <div className="gb-links">
            {event.roadMap && (
              <a href={event.roadMap} target="_blank" rel="noreferrer">
                Parcours <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
            <a href={event.siteWeb || ACP_CALENDAR_URL} target="_blank" rel="noreferrer">
              Inscription <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
          <MeteoToggle catalogEventId={event.id} />
          <TrackToggle catalogEventId={event.id} />
        </div>
      )}
    </li>
  );
}
