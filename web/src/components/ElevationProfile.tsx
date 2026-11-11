import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackPoint } from "../api/brmCatalog";
import { cumulativeGain, findClimbs, withProfile } from "../lib/gpxAnalysis";

const DEFAULT_VB_W = 600;
const VB_H = 170;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 20;

// Profil altimétrique avec survol (distance / altitude / D+ cumulé à ce point,
// comme sur OpenRunner) et les montées significatives mises en évidence — calculées
// une fois ici plutôt que renvoyées par le serveur, pour ne pas avoir à republier un
// format de données à chaque ajustement du seuil de détection.
export function ElevationProfile({
  points,
  onHoverPoint,
  cursorKm,
  markers,
  onSelectKm,
  showClimbList = true,
}: {
  points: TrackPoint[];
  // Position survolée reportée au composant parent, pour la montrer aussi sur la
  // carte (voir TrackMap `highlight`) — comme le fait OpenRunner entre son profil et
  // sa carte.
  onHoverPoint?: (point: TrackPoint | null) => void;
  // Position "sélectionnée" pilotée de l'extérieur (curseur km de la page Parcours
  // PBP), distincte du survol qui, lui, est éphémère.
  cursorKm?: number | null;
  markers?: { km: number; label: string }[];
  onSelectKm?: (km: number) => void;
  // Sur 1200 km la liste des montées dépasse la centaine de lignes : les bandes sur
  // le profil suffisent, la liste détaillée encombrerait l'écran d'un téléphone.
  showClimbList?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // viewBox calée sur la largeur réelle en pixels : avec une largeur fixe de 600, le
  // SVG (hauteur fixe) restait cantonné au centre sur grand écran, et un ratio
  // étiré aurait déformé le texte des axes.
  const [VB_W, setVbW] = useState(DEFAULT_VB_W);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setVbW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length]);

  const withEle = useMemo(() => withProfile(points), [points]);
  const gain = useMemo(() => cumulativeGain(withEle), [withEle]);
  const climbs = useMemo(() => findClimbs(withEle), [withEle]);

  const hoverPointForCallback = hoverIdx !== null ? withEle[hoverIdx] : null;
  useEffect(() => {
    onHoverPoint?.(hoverPointForCallback ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverPointForCallback]);
  useEffect(() => () => onHoverPoint?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ marginTop: 8 }} ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{ width: "100%", height: VB_H, display: "block", cursor: "crosshair" }}
        onMouseMove={(e) => handleMove(e.clientX)}
        onClick={() => hover && onSelectKm?.(hover.distKm)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={(e) => e.touches[0] && handleMove(e.touches[0].clientX)}
        onTouchMove={(e) => e.touches[0] && handleMove(e.touches[0].clientX)}
        onTouchEnd={() => {
          // Au doigt, "relâcher" vaut sélection : pas de survol durable sur mobile.
          if (hover) onSelectKm?.(hover.distKm);
          setHoverIdx(null);
        }}
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

        {(markers ?? []).map((m, i) => (
          <g key={i}>
            <line x1={x(m.km)} x2={x(m.km)} y1={PAD_T} y2={VB_H - PAD_B} stroke="var(--fg-muted)" strokeWidth={0.75} opacity={0.5} />
            <text x={x(m.km)} y={VB_H - 6} textAnchor="middle" fontSize={8} fill="var(--fg-muted)" fontFamily="JetBrains Mono, monospace">
              {m.label}
            </text>
          </g>
        ))}

        {typeof cursorKm === "number" && cursorKm >= 0 && cursorKm <= totalKm && (
          <line x1={x(cursorKm)} x2={x(cursorKm)} y1={PAD_T} y2={VB_H - PAD_B} stroke="#2563eb" strokeWidth={2} />
        )}

        {hover && (
          <>
            <line x1={x(hover.distKm)} x2={x(hover.distKm)} y1={PAD_T} y2={VB_H - PAD_B} stroke="var(--fg-muted)" strokeWidth={1} strokeDasharray="3,3" />
            <circle cx={x(hover.distKm)} cy={y(hover.ele as number)} r={3.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.5} />
          </>
        )}
      </svg>

      <div className="no-print" style={{ fontSize: 11.5, color: "var(--fg-muted)", fontFamily: "JetBrains Mono, monospace", minHeight: 16 }}>
        {hover
          ? `${hover.distKm.toFixed(1)} km · ${Math.round(hover.ele as number)} m · D+ cumulé ${hoverGain} m`
          : `0 → ${totalKm.toFixed(1)} km · passe la souris sur le profil`}
      </div>

      {showClimbList && climbs.length > 0 && (
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
