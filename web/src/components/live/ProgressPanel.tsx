import { Clock, Gauge, Mountain, Route } from "lucide-react";
import { duration, hhmm, km, meters, when, type LiveModel } from "./model";

// Bloc 3 (haut) : progression globale et 4 indicateurs.
export function ProgressPanel({ model, limitMinutes, now }: { model: LiveModel; limitMinutes: number; now: Date }) {
  const pct = Math.max(0, Math.min(100, (model.lastKm / model.totalKm) * 100));
  const left = Math.max(0, model.totalKm - model.lastKm);
  const elapsedMin = model.last && model.startAt ? (new Date(model.last.at).getTime() - model.startAt.getTime()) / 60_000 : null;
  const n = model.next;
  return (
    <section className="lv-card lv-progress" aria-labelledby="lv-prog-title">
      <h2 id="lv-prog-title">Progression</h2>
      <p className="lv-prog-line">
        <strong>{km(model.lastKm)}</strong> parcourus / {km(model.totalKm)} — <strong>{Math.round(pct)} %</strong>
      </p>
      <div className="lv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Progression sur le parcours">
        <span style={{ width: `${pct}%` }} />
      </div>

      <div className="lv-kpis">
        <div className="lv-kpi">
          <Route size={18} aria-hidden="true" />
          <span className="lv-kpi-cap">Distance</span>
          <strong>{km(model.lastKm)}</strong>
          <span>{left > 0 ? `${km(left)} restants` : "Parcours terminé"}</span>
        </div>
        <div className="lv-kpi">
          <Mountain size={18} aria-hidden="true" />
          <span className="lv-kpi-cap">Dénivelé</span>
          <strong>D+ {meters(model.gainDone)}</strong>
          <span>{left > 0 ? `D+ ${meters(model.gainLeft)} à gravir` : "Tout est grimpé"}</span>
        </div>
        <div className="lv-kpi">
          <Gauge size={18} aria-hidden="true" />
          <span className="lv-kpi-cap">Rythme</span>
          <strong>{model.avgKmh ? `${model.avgKmh.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km/h` : "—"}</strong>
          <span>{elapsedMin !== null && elapsedMin > 0 ? `moyenne pauses comprises, en route depuis ${duration(elapsedMin)}` : "moyenne pauses comprises"}</span>
        </div>
        <div className="lv-kpi">
          <Clock size={18} aria-hidden="true" />
          <span className="lv-kpi-cap">Prochain objectif</span>
          {model.status === "abandon" ? (
            <>
              <strong>Brevet arrêté</strong>
              <span>au km {Math.round(model.lastKm)}</span>
            </>
          ) : model.status === "arrive" ? (
            <>
              <strong>Arrivé{elapsedMin ? ` en ${duration(elapsedMin)}` : ""}</strong>
              <span>{elapsedMin !== null ? (elapsedMin <= limitMinutes ? "dans les délais" : "hors délai officiel") : ""}</span>
            </>
          ) : n ? (
            <>
              <strong>{n.row.name}</strong>
              <span>
                dans {km(n.kmLeft)}
                {n.etaMin && n.etaMax
                  ? Math.abs(n.etaMax.getTime() - n.etaMin.getTime()) < 10 * 60_000
                    ? `, vers ${when(n.etaMin, now)}`
                    : `, entre ${when(n.etaMin, now)} et ${hhmm(n.etaMax)}`
                  : ""}
              </span>
              {n.closeAt && <span className="lv-kpi-sub">Fermeture du contrôle : {when(n.closeAt, now)}</span>}
            </>
          ) : (
            <>
              <strong>—</strong>
              <span>en attente du premier pointage</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
