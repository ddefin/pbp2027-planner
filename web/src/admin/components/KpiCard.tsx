import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Skeleton } from "./States";
import { fmtNum } from "../format";
import type { Kpi } from "../types";

// Carte d'indicateur : valeur + variation vs période précédente. `goodWhenUp` = false pour
// les incidents (une hausse est mauvaise). Flèche + signe + texte : jamais la couleur seule.
export function KpiCard({ icon: Icon, label, kpi, hint, goodWhenUp = true, loading }: { icon: LucideIcon; label: string; kpi?: Kpi; hint?: string; goodWhenUp?: boolean; loading?: boolean }) {
  const c = kpi?.change ?? null;
  const tone = c === null || c === 0 ? "flat" : (c > 0) === goodWhenUp ? "good" : "bad";
  const Arrow = c === null || c === 0 ? Minus : c > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="ad-kpi">
      <div className="ad-kpi-head">
        <span>{label}</span>
        <Icon size={16} aria-hidden="true" />
      </div>
      {loading || !kpi ? (
        <>
          <Skeleton width={90} height={30} />
          <Skeleton width={140} height={12} />
        </>
      ) : (
        <>
          <div className="ad-kpi-value ad-num">{fmtNum(kpi.value)}</div>
          <div className="ad-kpi-foot">
            {c !== null && (
              <span className={`ad-delta is-${tone}`}>
                <Arrow size={14} aria-hidden="true" />
                {/* Au-delà de ±999 %, le chiffre exact n'apporte rien (période précédente quasi vide). */}
                {Math.abs(c) > 999 ? `${c > 0 ? "> +" : "< −"}999 %` : `${c > 0 ? "+" : ""}${c.toLocaleString("fr-FR")} %`}
              </span>
            )}
            <span className="ad-kpi-hint">{c === null ? (kpi.previous === 0 ? "rien sur la période précédente" : "pas de comparaison") : "vs période précédente"}</span>
          </div>
          {hint && <div className="ad-kpi-hint">{hint}</div>}
        </>
      )}
    </div>
  );
}
