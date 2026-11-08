import { useMemo, useRef, useState } from "react";
import type { TrackPoint } from "../api/brmCatalog";
import { cumulativeGain, findClimbs, withProfile } from "../lib/gpxAnalysis";

const VB_W = 600;
const VB_H = 170;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 20;

// Profil altimétrique avec survol (distance / altitude / D+ cumulé à ce point,
// comme sur OpenRunner) et les montées significatives mises en évidence — calculées
// une fois ici plutôt que renvoyées par le serveur, pour ne pas avoir à republier un
// format de données à chaque ajustement du seuil de détection.
export function ElevationProfile({ points }: { points: TrackPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const withEle = useMemo(() => withProfile(points), [points]);
  const gain = useMemo(() => cumulativeGain(withEle), [withEle]);
  const climbs = useMemo(() => findClimbs(withEle), [withEle]);

  if (withEle.length < 2) return null;

  const totalKm = withEle[withEle.length - 1].distKm;
  const eles = withEle.map((p) => p.ele as number);
  const minEle = Math.min(...eles);
  const maxEle = Math.max(...eles);
  const eleRange = Math.max(1, maxEle - minEle);

  const x = (km: number) => PAD_L + (km / totalKm) * (VB_W - PAD_L - PAD_R);
  const y = (ele: number) => VB_H - PAD_B - ((ele - minEle) / eleRange) * (VB_H - PAD_T - PAD_B);

  const linePath = withEle.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.distKm).toFixed(1)},${y(p.ele as number).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(totalKm).toFixed(1)},${VB_H - PAD_B} L${x(0).toFixed(1)},${VB_H - PAD_B} Z`;

  function handleMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const km = Math.max(0, Math.min(totalKm, ratio * totalKm));
    // Point le plus proche en distance (recherche linéaire : au plus quelques
    // centaines d'échantillons après décimation côté serveur, largement suffisant).
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < withEle.length; i++) {
      const diff = Math.abs(withEle[i].distKm - km);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    setHoverIdx(best);
  }

  const hover = hoverIdx !== null ? withEle[hoverIdx] : null;
  const hoverGain = hoverIdx !== null ? gain[hoverIdx] : null;

  return (
    <div style={{ marginTop: 8 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{ width: "100%", height: 150, display: "block", cursor: "crosshair" }}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => e.touches[0] && handleMove(e.touches[0].clientX)}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {/* grille horizontale discrète */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={PAD_T + f * (VB_H - PAD_T - PAD_B)}
            y2={PAD_T + f * (VB_H - PAD_T - PAD_B)}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}

        {/* montées significatives, en évidence */}
        {climbs.map((c, i) => (
          <rect
            key={i}
            x={x(c.startKm)}
            y={PAD_T}
            width={Math.max(1, x(c.endKm) - x(c.startKm))}
            height={VB_H - PAD_T - PAD_B}
            fill="var(--accent)"
            opacity={0.12}
          />
        ))}

        <path d={areaPath} fill="var(--accent)" opacity={0.18} />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />

        {/* axe Y : min / max altitude */}
        <text x={PAD_L - 4} y={y(maxEle) + 3} textAnchor="end" fontSize={9} fill="var(--fg-muted)" fontFamily="JetBrains Mono, monospace">
          {Math.round(maxEle)}
        </text>
        <text x={PAD_L - 4} y={y(minEle) + 3} textAnchor="end" fontSize={9} fill="var(--fg-muted)" fontFamily="JetBrains Mono, monospace">
          {Math.round(minEle)}
        </text>

        {hover && (
          <>
            <line x1={x(hover.distKm)} x2={x(hover.distKm)} y1={PAD_T} y2={VB_H - PAD_B} stroke="var(--fg-muted)" strokeWidth={1} strokeDasharray="3,3" />
            <circle cx={x(hover.distKm)} cy={y(hover.ele as number)} r={3.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.5} />
          </>
        )}
      </svg>

      <div style={{ fontSize: 11.5, color: "var(--fg-muted)", fontFamily: "JetBrains Mono, monospace", minHeight: 16 }}>
        {hover
          ? `${hover.distKm.toFixed(1)} km · ${Math.round(hover.ele as number)} m · D+ cumulé ${hoverGain} m`
          : `0 → ${totalKm.toFixed(1)} km · passe la souris sur le profil`}
      </div>

      {climbs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="hint" style={{ margin: "0 0 4px", fontWeight: 700 }}>Montées significatives</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {climbs.map((c, i) => (
              <div key={i} className="hint" style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  km {c.startKm.toFixed(1)}–{c.endKm.toFixed(1)} ({c.lengthKm} km)
                </span>
                <span className="tabular">
                  D+ {c.gainM} m · {c.avgGrade}% moy · {c.maxGrade}% max
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
