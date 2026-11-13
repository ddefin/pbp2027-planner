import { useMemo, useState } from "react";
import type { Overview } from "../types";
import { fmtNum } from "../format";

type SeriesKey = "messages" | "pointages" | "inscriptions";
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: "messages", label: "Messages du groupe" },
  { key: "pointages", label: "Pointages roadbook" },
  { key: "inscriptions", label: "Inscriptions" },
];

// Une série à la fois (échelles trop différentes pour un seul axe) : barres fines à bout
// arrondi, grille discrète, info-bulle au survol ou au clavier, tableau de données accessible.
export function ActivityChart({ series }: { series: Overview["series"] }) {
  const [key, setKey] = useState<SeriesKey>("messages");
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, P = { l: 36, r: 8, t: 12, b: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(1, ...series.map((s) => s[key]));
  const nice = useMemo(() => {
    const raw = max / 3;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, Math.ceil(raw / pow) * pow);
    return { step, top: step * 3 };
  }, [max]);
  const step = iw / Math.max(1, series.length);
  const bw = Math.max(2, Math.min(22, step - 2)); // 2 px d'écart minimum entre les barres
  const y = (v: number) => P.t + ih - (v / nice.top) * ih;
  const labelEvery = Math.ceil(series.length / 8);
  const total = series.reduce((s, b) => s + b[key], 0);
  const current = SERIES.find((s) => s.key === key)!;

  return (
    <div className="ad-chart">
      <div className="ad-chart-head">
        <div>
          <div className="ad-chart-title">{current.label}</div>
          <div className="ad-chart-sub ad-num">{fmtNum(total)} sur la période</div>
        </div>
        <div className="ad-seg" role="group" aria-label="Série affichée">
          {SERIES.map((s) => (
            <button key={s.key} type="button" aria-pressed={key === s.key} onClick={() => setKey(s.key)}>
              {s.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="ad-chart-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${current.label} : ${fmtNum(total)} sur la période, maximum ${fmtNum(max)}.`}>
          {[0, 1, 2, 3].map((g) => (
            <g key={g}>
              <line x1={P.l} x2={W - P.r} y1={y(g * nice.step)} y2={y(g * nice.step)} className={g === 0 ? "ad-axis" : "ad-grid"} />
              <text x={P.l - 6} y={y(g * nice.step) + 4} textAnchor="end" className="ad-tick">
                {fmtNum(g * nice.step)}
              </text>
            </g>
          ))}
          {series.map((b, i) => {
            const v = b[key];
            const h = Math.max(v > 0 ? 2 : 0, (v / nice.top) * ih);
            const x = P.l + i * step + (step - bw) / 2;
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={b.key}>
                {/* Barre arrondie seulement côté valeur, ancrée sur l'axe */}
                {h > 0 && <path d={`M${x},${P.t + ih} V${P.t + ih - h + r} Q${x},${P.t + ih - h} ${x + r},${P.t + ih - h} H${x + bw - r} Q${x + bw},${P.t + ih - h} ${x + bw},${P.t + ih - h + r} V${P.t + ih} Z`} className={`ad-bar${hover === i ? " is-hover" : ""}`} />}
                {/* Zone de survol plus large que la barre */}
                <rect x={P.l + i * step} y={P.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
                {i % labelEvery === 0 && (
                  <text x={P.l + i * step + step / 2} y={H - 8} textAnchor="middle" className="ad-tick">
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && series[hover] && (
          <div className="ad-tooltip" style={{ left: `${((P.l + hover * step + step / 2) / W) * 100}%` }} role="status">
            <strong>{series[hover].label}</strong>
            <span className="ad-num">
              {fmtNum(series[hover][key])} {current.label.toLowerCase()}
            </span>
          </div>
        )}
      </div>
      <details className="ad-table-view">
        <summary>Voir les données</summary>
        <div className="ad-table-scroll">
          <table className="ad-table ad-table-compact">
            <thead>
              <tr>
                <th scope="col">Période</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((b) => (
                <tr key={b.key}>
                  <th scope="row">{b.label}</th>
                  {SERIES.map((s) => (
                    <td key={s.key} className="num ad-num">
                      {fmtNum(b[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
