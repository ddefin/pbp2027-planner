import { formatMinutes, type LiveStatus, type StatusLevel } from "../../lib/roadbook";

const LEVEL_WORD: Record<StatusLevel, string> = { ok: "Dans les temps", tight: "Tangent", late: "En retard" };

function clock(startAt: string | null, minutes: number): string {
  if (!startAt) return `+${formatMinutes(minutes)}`;
  return new Date(new Date(startAt).getTime() + minutes * 60_000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Deux voyants indépendants, parce qu'ils ne répondent pas à la même question :
// "suis-je dans MON plan ?" (on peut être en retard sur son plan mais très large sur
// les barrières) et "vais-je être éliminé ?". Couleurs pleines + gros chiffres : le
// tout doit se lire en une seconde, guidon à la main, en plein soleil.
export function StatusPanel({ status, startAt, asOf }: { status: LiveStatus; startAt: string | null; asOf?: string | null }) {
  const plan = status.planDeltaMin;
  const barrierWord = status.closedAlready ? "Hors délai" : LEVEL_WORD[status.barrierLevel];
  const finished = status.remainingKm === 0 && !status.nextControl;

  return (
    <div className="status-panel">
      <div className={`status-tile lvl-${status.planLevel}`}>
        <div className="status-label">Mon objectif</div>
        <div className="status-big">{plan >= 0 ? `+${formatMinutes(plan)}` : formatMinutes(plan)}</div>
        <div className="status-sub">{plan >= 0 ? "d'avance sur mon roadbook" : "de retard sur mon roadbook"}</div>
      </div>

      {finished ? (
        <div className={`status-tile lvl-${status.closedAlready ? "late" : "ok"}`}>
          <div className="status-label">Arrivée</div>
          <div className="status-big">{status.closedAlready ? "✗" : "✓"}</div>
          <div className="status-sub">{status.closedAlready ? "Arrivé hors délai" : `Brevet bouclé en ${formatMinutes(status.elapsedMin)}`}</div>
        </div>
      ) : (
        <div className={`status-tile lvl-${status.closedAlready ? "late" : status.barrierLevel}`}>
          <div className="status-label">Barrière horaire</div>
          <div className="status-big">{status.barrierMarginMin === null ? "—" : formatMinutes(status.barrierMarginMin)}</div>
          <div className="status-sub">
            {status.nextControl
              ? `${barrierWord} · ${status.nextControl.name} ferme à ${clock(startAt, status.nextControl.closeMin)}`
              : barrierWord}
          </div>
        </div>
      )}

      <div className="status-facts tabular">
        <div>
          <span>Position</span>
          <strong>km {Math.round(status.km)}</strong>
        </div>
        <div>
          <span>Écoulé</span>
          <strong>{formatMinutes(status.elapsedMin)}</strong>
        </div>
        <div>
          <span>Reste</span>
          <strong>{status.remainingKm} km</strong>
        </div>
        {status.nextControl && (
          <div>
            <span>Prochain contrôle</span>
            <strong>
              {status.nextControl.name} · {Math.round(status.nextControl.km - status.km)} km
            </strong>
          </div>
        )}
        <div>
          <span>Vitesse mini → prochain CP</span>
          <strong>{status.requiredSpeedNextKmh === null ? "—" : `${status.requiredSpeedNextKmh} km/h`}</strong>
        </div>
        <div>
          <span>Moyenne mini pour finir</span>
          <strong>{status.requiredSpeedFinishKmh === null ? "—" : `${status.requiredSpeedFinishKmh} km/h`}</strong>
        </div>
      </div>
      {asOf && <div className="status-asof">Position du {new Date(asOf).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>}
    </div>
  );
}
