import type { TrackPoint } from "../../api/brmCatalog";
import type { PbpControl } from "../../api/pbpRoutes";
import { SERVICE_ICON, SERVICE_LABEL } from "../../lib/pbpMeta";
import { elevationBetween, etaAt, formatEta } from "../../lib/routeMath";

// Au-delà, le tracé passe "près" de la ville sans la traverser : le km affiché est
// celui du point le plus proche, à prendre avec précaution.
const OFFSET_WARNING_KM = 3;

export function ControlsTable({
  controls,
  points,
  start,
  speedKmh,
  indicative,
  onSelectKm,
}: {
  controls: PbpControl[];
  points: TrackPoint[];
  start: string;
  speedKmh: number;
  indicative: boolean;
  onSelectKm: (km: number) => void;
}) {
  let prevKm: number | null = null;

  return (
    <div className="ctrl-table-wrap">
      <table className="ctrl-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ville</th>
            <th className="num">Km</th>
            <th className="num">Étape</th>
            {!indicative && <th className="num">D+</th>}
            <th>Passage</th>
          </tr>
        </thead>
        <tbody>
          {controls.map((c) => {
            const partial = c.km !== null && prevKm !== null ? c.km - prevKm : null;
            const elev = !indicative && c.km !== null && prevKm !== null ? elevationBetween(points, prevKm, c.km) : null;
            const row = (
              <tr key={c.step} className={c.km === null ? "is-missing" : undefined} onClick={() => c.km !== null && onSelectKm(c.km)}>
                <td className="tabular">{c.step}</td>
                <td>
                  <div className="ctrl-name">{c.name}</div>
                  <div className="ctrl-services" title={c.services.map((s) => SERVICE_LABEL[s]).join(", ")}>
                    {c.services.map((s) => SERVICE_ICON[s]).join(" ")}
                    {c.note && <span className="ctrl-note"> · {c.note}</span>}
                    {c.offsetKm !== null && c.offsetKm > OFFSET_WARNING_KM && <span className="ctrl-note"> · tracé à {c.offsetKm} km du centre</span>}
                  </div>
                </td>
                <td className="num tabular">
                  {c.km === null ? "—" : `${indicative && c.officialKm === null ? "≈" : ""}${Math.round(c.km)}`}
                </td>
                <td className="num tabular">{partial === null ? "" : Math.round(partial)}</td>
                {!indicative && <td className="num tabular">{elev ? elev.gain : ""}</td>}
                <td className="tabular">{c.km === null ? "hors tracé" : formatEta(etaAt(start, speedKmh, c.km))}</td>
              </tr>
            );
            if (c.km !== null) prevKm = c.km;
            return row;
          })}
        </tbody>
      </table>
      {indicative && (
        <p className="hint" style={{ marginBottom: 0 }}>
          ≈ : kilométrage estimé (ligne droite recalée sur les distances officielles connues : Mortagne 119 km, Brest 590 km,
          arrivée 1220 km). Remplacé automatiquement par le vrai kilométrage dès qu'un GPX est importé.
        </p>
      )}
    </div>
  );
}
