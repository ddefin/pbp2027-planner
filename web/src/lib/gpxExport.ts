import type { ControlPoint } from "../api/brmCatalog";
import type { TrackPoint } from "../api/brmCatalog";

const KIND_SYM: Record<ControlPoint["kind"], string> = {
  depart: "Flag, Green",
  arrivee: "Flag, Checkered",
  ravito: "Restaurant",
  controle: "Pin, Blue",
};

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Reconstruit un GPX complet (trace + waypoints) à partir du tracé déjà stocké
// (décimé, voir src/lib/gpx.ts) et des points de ravito/contrôle posés sur la
// carte — permet de récupérer dans un GPS/une appli tierce ce que le groupe a
// préparé ici, pas seulement de le visualiser dans l'app.
export function buildEnrichedGpx(opts: { name: string; points: TrackPoint[]; controlPoints: ControlPoint[] }): string {
  const trkpts = opts.points
    .map((p) => {
      const ele = typeof p.ele === "number" ? `<ele>${p.ele.toFixed(1)}</ele>` : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lon}">${ele}</trkpt>`;
    })
    .join("\n");

  const wpts = opts.controlPoints
    .map(
      (cp) =>
        `  <wpt lat="${cp.lat}" lon="${cp.lon}">\n    <name>${escapeXml(cp.label)}</name>\n    <sym>${KIND_SYM[cp.kind]}</sym>\n  </wpt>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PBP2027 Planner" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <trk>
    <name>${escapeXml(opts.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
