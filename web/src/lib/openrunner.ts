// Miroir de src/lib/openrunner.ts (backend) pour détecter côté client si un lien
// "parcours" du calendrier ACP pointe vers OpenRunner et peut donc être affiché en
// carte intégrée, plutôt qu'un simple lien sortant.
export function extractOpenRunnerRouteId(url: string): string | null {
  const m = url.match(/openrunner\.com\/route-details\/(\d+)/i);
  return m ? m[1] : null;
}
