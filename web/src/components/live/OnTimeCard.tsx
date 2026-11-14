import { CircleCheck, CircleX, Flag, TriangleAlert } from "lucide-react";
import type { LiveView } from "../../api/roadbooks";
import { barrierPhrase, finishPhrase, humanDuration, planPhrase, type OnTimeLevel } from "../../../../src/shared/onTime";
import { when, type LiveModel } from "./model";

const ICON: Record<OnTimeLevel, typeof CircleCheck> = { ok: CircleCheck, tight: TriangleAlert, late: CircleX };

export function barrierOf(live: LiveView | null, model: LiveModel) {
  if (!live || (model.status !== "route" && model.status !== "pause")) return null;
  return barrierPhrase({ marginMin: live.barrierMarginMin, level: live.barrierLevel, controlName: live.nextControl?.name ?? null });
}

// Badge compact pour l'en-tête collant.
export function OnTimeBadge({ live, model }: { live: LiveView | null; model: LiveModel }) {
  const b = barrierOf(live, model);
  if (!b) return null;
  const Icon = ICON[b.level];
  return (
    <span className={`lv-ontime-badge is-${b.level}`} title={b.long}>
      <Icon size={15} aria-hidden="true" /> {b.short}
    </span>
  );
}

// « Dans les temps ? » : barrière officielle, plan perso, arrivée estimée.
export function OnTimeCard({ live, model, limitMinutes, now }: { live: LiveView | null; model: LiveModel; limitMinutes: number; now: Date }) {
  if (!model.last || model.status === "abandon") return null;

  if (model.status === "arrive") {
    if (!model.startAt) return null;
    const elapsed = (new Date(model.last.at).getTime() - model.startAt.getTime()) / 60_000;
    const f = finishPhrase(elapsed, limitMinutes);
    return (
      <div className={`lv-ontime is-${f.level}`}>
        <p className="lv-ontime-main">
          <Flag size={18} aria-hidden="true" /> {f.text}
        </p>
      </div>
    );
  }
  if (!live) return null;

  const barrier = barrierOf(live, model);
  const plan = planPhrase(live.planDeltaMin);
  const pace = live.paceFinishAt ? new Date(live.paceFinishAt) : null;
  const planned = live.plannedFinishAt ? new Date(live.plannedFinishAt) : null;
  const limit = live.limitAt ? new Date(live.limitAt) : null;
  const best = pace ?? planned;
  const finishMargin = best && limit ? (limit.getTime() - best.getTime()) / 60_000 : null;
  if (!barrier && !plan && !best) return null;
  const level: OnTimeLevel = barrier?.level ?? plan?.level ?? "ok";
  const Icon = ICON[level];

  return (
    <div className={`lv-ontime is-${level}`} aria-label="Est-il dans les temps ?">
      <p className="lv-ontime-cap">Est-il dans les temps ?</p>
      {barrier && (
        <p className="lv-ontime-main">
          <Icon size={18} aria-hidden="true" /> {barrier.long}
          {live.nextControl?.closeAt && <span className="lv-muted"> (fermeture {when(new Date(live.nextControl.closeAt), now)})</span>}
        </p>
      )}
      <dl className="lv-ontime-grid">
        {plan && (
          <div>
            <dt>Son plan</dt>
            <dd className={`is-${plan.level}`}>{plan.text}</dd>
            <dd className="lv-muted">par rapport aux horaires qu'il s'était fixés</dd>
          </div>
        )}
        {best && (
          <div>
            <dt>Arrivée estimée</dt>
            <dd>
              vers <strong>{when(best, now)}</strong> {pace ? "à son rythme actuel" : "selon son plan"}
            </dd>
            {pace && planned && Math.abs(pace.getTime() - planned.getTime()) > 15 * 60_000 && <dd className="lv-muted">{when(planned, now)} selon son plan</dd>}
          </div>
        )}
        {limit && (
          <div>
            <dt>Délai officiel</dt>
            <dd>
              <strong>{when(limit, now)}</strong>
            </dd>
            {finishMargin !== null && (
              <dd className={finishMargin >= 0 ? "lv-muted" : "is-late"}>
                {finishMargin >= 0 ? `marge estimée ${humanDuration(finishMargin)}` : `dépassement estimé ${humanDuration(finishMargin)}`}
              </dd>
            )}
          </div>
        )}
      </dl>
    </div>
  );
}
