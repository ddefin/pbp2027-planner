import { ExternalLink } from "lucide-react";
import type { LiveView } from "../../api/roadbooks";
import { OnTimeBadge } from "./OnTimeCard";
import { StatusBadge } from "./StatusBadge";
import { ago, when, type LiveModel } from "./model";

// Bloc 1 : qui, quel brevet, dernier pointage, statut, liens de suivi continu.
export function LiveHeader({
  author,
  title,
  model,
  live,
  liveTrackUrl,
  beaconUrl,
  now,
}: {
  author: string;
  title: string;
  model: LiveModel;
  live: LiveView | null;
  liveTrackUrl: string | null | undefined;
  beaconUrl: string | null | undefined;
  now: Date;
}) {
  const { last, status } = model;
  const quietH = last ? (now.getTime() - new Date(last.at).getTime()) / 3_600_000 : 0;
  return (
    <header className="lv-head">
      <div className="lv-head-inner">
        <div className="lv-head-who">
          <img src="/favicon.svg" alt="" width={34} height={34} />
          <div>
            <h1>{author}</h1>
            <p>{title}</p>
          </div>
        </div>
        <div className="lv-head-state" aria-live="polite">
          {status && last ? (
            <>
              <StatusBadge status={status} />
              <OnTimeBadge live={live} model={model} />
              <p className="lv-head-last">
                Pointé à <strong>{model.lastPlace}</strong> à <strong>{when(new Date(last.at), now)}</strong>
                <span className="lv-head-ago"> — {ago(last.at, now)}</span>
              </p>
            </>
          ) : (
            <p className="lv-head-last">
              Pas encore de pointage
              {model.startAt ? ` — départ prévu ${model.startAt.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          )}
        </div>
        {(liveTrackUrl || beaconUrl) && (
          <div className="lv-head-links">
            {liveTrackUrl && (
              <a className="lv-ext is-garmin" href={liveTrackUrl} target="_blank" rel="noopener noreferrer">
                Suivre sur Garmin LiveTrack <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
            {beaconUrl && (
              <a className="lv-ext is-strava" href={beaconUrl} target="_blank" rel="noopener noreferrer">
                Suivre sur Strava Beacon <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>
      {status === "route" && quietH >= 3 && (
        <p className="lv-head-note">
          Pas de nouveau pointage depuis {Math.floor(quietH)} h : c'est fréquent entre deux contrôles (pas de réseau, pas d'arrêt).
          {liveTrackUrl || beaconUrl ? " Le suivi GPS continu ci-dessus donne sa position réelle." : ""}
        </p>
      )}
    </header>
  );
}
