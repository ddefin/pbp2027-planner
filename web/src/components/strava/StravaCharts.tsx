import { useState } from "react";
import type { Dashboard, Share } from "../../api/strava";

const fmt = (n: number, d = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

// Tendance des 8 dernières semaines : barres = volume (km), ligne = charge d'entraînement.
export function TrendChart({ weekly }: { weekly: Dashboard["weekly"] }) {
  const [metric, setMetric] = useState<"km" | "hours" | "elevationM">("km");
  const W = 340, H = 170, PAD = { l: 8, r: 8, t: 14, b: 26 };
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const maxBar = Math.max(1, ...weekly.map((w) => w[metric]));
  const maxLoad = Math.max(1, ...weekly.map((w) => w.load));
  const step = innerW / weekly.length;
  const bw = Math.min(28, step * 0.62);
  const x = (i: number) => PAD.l + step * i + step / 2;
  const line = weekly.map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${(PAD.t + innerH - (w.load / maxLoad) * innerH).toFixed(1)}`).join(" ");
  const label = { km: "Distance (km)", hours: "Durée (h)", elevationM: "Dénivelé (m)" }[metric];
  const last = weekly[weekly.length - 1];
  return (
    <div className="sv-trend">
      <div className="sv-seg" role="group" aria-label="Métrique du graphique">
        {(["km", "hours", "elevationM"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
            {{ km: "km", hours: "heures", elevationM: "D+" }[m]}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Évolution sur 8 semaines : ${label} et charge. Semaine en cours : ${fmt(last[metric], 1)}.`} className="sv-svg">
        {[0.5, 1].map((g) => (
          <line key={g} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - g)} y2={PAD.t + innerH * (1 - g)} className="sv-grid" />
        ))}
        {weekly.map((w, i) => {
          const h = (w[metric] / maxBar) * innerH;
          return (
            <g key={w.weekStart}>
              <rect x={x(i) - bw / 2} y={PAD.t + innerH - h} width={bw} height={Math.max(h, w[metric] > 0 ? 2 : 0)} rx={4} className={i === weekly.length - 1 ? "sv-bar sv-bar-now" : "sv-bar"} />
              <text x={x(i)} y={PAD.t + innerH - h - 4} textAnchor="middle" className="sv-val">
                {w[metric] > 0 ? fmt(w[metric], metric === "hours" ? 1 : 0) : ""}
              </text>
              <text x={x(i)} y={H - 8} textAnchor="middle" className="sv-axis">
                {new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}
              </text>
            </g>
          );
        })}
        <path d={line} className="sv-line" fill="none" />
        {weekly.map((w, i) => (
          <circle key={w.weekStart} cx={x(i)} cy={PAD.t + innerH - (w.load / maxLoad) * innerH} r={3} className="sv-dot" />
        ))}
      </svg>
      <div className="sv-legend">
        <span>
          <i className="sv-key sv-key-bar" /> {label}
        </span>
        <span>
          <i className="sv-key sv-key-line" /> Charge (pic : {fmt(maxLoad)})
        </span>
      </div>
    </div>
  );
}

// Jauge du ratio charge aiguë / chronique : zones « sous-charge, optimal, vigilance, danger ».
export function AcwrGauge({ acwr }: { acwr: number | null }) {
  const max = 2;
  const pos = acwr === null ? null : Math.min(Math.max(acwr, 0), max) / max;
  const zone = acwr === null ? null : acwr > 1.5 ? ["alerte", "Zone de danger"] : acwr > 1.3 ? ["attention", "Zone de vigilance"] : acwr >= 0.8 ? ["ok", "Zone optimale"] : ["info", "Sous-charge"];
  return (
    <div>
      <div className="sv-big tabular">{acwr === null ? "—" : acwr.toFixed(2)}</div>
      <div className="sv-gauge" aria-hidden="true">
        <span style={{ width: "40%" }} className="sv-g-low" />
        <span style={{ width: "25%" }} className="sv-g-ok" />
        <span style={{ width: "10%" }} className="sv-g-warn" />
        <span style={{ width: "25%" }} className="sv-g-bad" />
        {pos !== null && <i className="sv-g-mark" style={{ left: `${pos * 100}%` }} />}
      </div>
      <div className={`sv-sub sv-lvl-${zone?.[0] ?? "info"}`}>{zone ? zone[1] : "Pas assez de données"}</div>
    </div>
  );
}

// Répartition des intensités : barre empilée endurance / allure moyenne / haute intensité.
export function IntensityBar({ share, label }: { share: Share; label: string }) {
  if (share.coveredSeconds === 0) return <p className="sv-sub">Aucune sortie avec cardio ou capteur de puissance {label}.</p>;
  return (
    <div>
      <div className="sv-stack" role="img" aria-label={`${share.low} % endurance, ${share.mid} % allure moyenne, ${share.high} % haute intensité`}>
        <span className="sv-s-low" style={{ width: `${share.low}%` }}>{share.low >= 12 ? `${share.low} %` : ""}</span>
        <span className="sv-s-mid" style={{ width: `${share.mid}%` }}>{share.mid >= 12 ? `${share.mid} %` : ""}</span>
        <span className="sv-s-high" style={{ width: `${share.high}%` }}>{share.high >= 12 ? `${share.high} %` : ""}</span>
      </div>
      <div className="sv-legend">
        <span><i className="sv-key sv-s-low" /> Endurance Z1-Z2 · {share.low} %</span>
        <span><i className="sv-key sv-s-mid" /> Tempo Z3 · {share.mid} %</span>
        <span><i className="sv-key sv-s-high" /> Intense Z4-Z5 · {share.high} %</span>
      </div>
    </div>
  );
}
