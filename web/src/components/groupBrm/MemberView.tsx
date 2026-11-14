import { Check } from "lucide-react";
import { CATALOG_STATUS_LABEL } from "../../lib/brmMeta";
import { DistanceBadge } from "./DistanceBadge";
import { Avatar } from "../Avatar";
import { dayLabel, memberSteps, type Member } from "./model";

const label = (s: string) => CATALOG_STATUS_LABEL[s as keyof typeof CATALOG_STATUS_LABEL] ?? s;

// Progression de chaque randonneur dans la série 200/300/400/600 (un 1000 vaut pour le
// 600), d'après ses choix sur le calendrier, puis ses BRM.
export function MemberView({ members, dist, showPast, today }: { members: Member[]; dist: number | null; showPast: boolean; today: string }) {
  return (
    <ul className="gb-members">
      {members.map((m) => {
        const steps = memberSteps(m);
        const done = steps.filter((s) => s.status === "homologue").length;
        const entries = m.entries.filter(({ event }) => (dist === null || event.distance === dist) && (showPast || event.date >= today));
        return (
          <li key={m.key} className={`gb-member${m.mine ? " is-me" : ""}`}>
            <div className="gb-member-head">
              <Avatar name={m.name} avatar={m.avatar} size={32} />
              <strong>
                {m.name}
                {m.mine ? " (toi)" : ""}
              </strong>
              <span className="gb-member-score" aria-label={`${done} étapes homologuées sur 4`}>
                {done}/4
              </span>
            </div>
            <ol className="gb-steps" aria-label="Étapes de qualification">
              {steps.map((s) => (
                <li key={s.step} className={`gb-step is-${s.status ?? "vide"}`} title={s.status ? `${label(s.status)}${s.via ? ` (via ${s.via})` : ""}` : "Rien de prévu"}>
                  <span className="gb-step-km">
                    {s.status === "homologue" && <Check size={12} aria-hidden="true" />}
                    {s.step}
                  </span>
                  <span className="gb-step-st">{s.status ? label(s.status) : "—"}</span>
                  {s.via && <span className="gb-step-via">via {s.via}</span>}
                </li>
              ))}
            </ol>
            {entries.length > 0 ? (
              <ul className="gb-member-brms">
                {entries.map(({ event, status }) => (
                  <li key={event.id} className={event.date < today ? "is-past" : undefined}>
                    <DistanceBadge distance={event.distance} />
                    <span className="gb-member-brm-main">
                      <strong>{dayLabel(event.date)}</strong> {event.ville}
                    </span>
                    <span className={`gb-st is-${status}`}>{label(status)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="gb-muted gb-member-empty">Aucun BRM pour ces filtres.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
