import { createHash } from "node:crypto";

// API publique (non documentée) derrière le formulaire "Calendrier des BRM" de
// https://www.audax-club-parisien.com/organisation/brm-monde/ — trouvée en lisant
// le JS de la page. Pas de clé d'API, pas de contrat de stabilité garanti : si l'ACP
// change ce endpoint, cette intégration casse et il faudra le réajuster.
const ACP_API_URL = "https://brevets.audax-club-parisien.com/controleur/api/brm_calendar.php";
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface AcpCatalogEvent {
  id: string;
  date: string; // yyyy-mm-dd
  distance: number;
  ville: string;
  departement: string;
  region: string;
  club: string;
  contact: string;
  siteWeb: string;
  roadMap: string;
  denivele: number;
}

interface RawAcpEvent {
  Date: string; // "DD/MM/YYYY"
  Distance: number;
  Pays: string;
  SiteWeb: string;
  Ville: string;
  Departement: string;
  Region: string;
  RoadMap: string;
  Denivele: number;
  Contact: string;
  NomClub: string;
}

interface CacheEntry {
  key: string;
  expiresAt: number;
  data: AcpCatalogEvent[];
}

let cache: CacheEntry | null = null;

// L'ACP ne fournit pas d'identifiant stable par événement : on en dérive un à partir
// des champs qui identifient un brevet de façon quasi unique. Si l'un de ces champs
// change d'une synchronisation à l'autre côté ACP, l'id change aussi (un même brevet
// réapparaîtra comme "nouveau" plutôt que de casser — c'est le compromis accepté).
function stableId(raw: RawAcpEvent): string {
  return createHash("sha1")
    .update(`${raw.Date}|${raw.Distance}|${raw.Ville}|${raw.NomClub}`)
    .digest("hex")
    .slice(0, 16);
}

// "DD/MM/YYYY" -> "YYYY-MM-DD". Le champ TimeDate renvoyé par l'API est un epoch UTC
// qui correspond à minuit *heure de Paris*, donc le convertir naïvement en date UTC
// décale certains événements d'un jour : on parse le champ Date texte à la place.
function parseFrenchDate(value: string): string {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

async function fetchRaw(from: string, to: string): Promise<RawAcpEvent[]> {
  const body = new URLSearchParams({
    action: "search",
    startdate: from,
    enddate: to,
    distance: "",
    region: "",
    departement: "",
    pays: "France",
  });
  const res = await fetch(ACP_API_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`ACP catalog fetch failed: HTTP ${res.status}`);
  return (await res.json()) as RawAcpEvent[];
}

export async function fetchFranceBrmCatalog(opts: {
  from: string;
  to: string;
  distances: readonly number[];
}): Promise<AcpCatalogEvent[]> {
  const cacheKey = `${opts.from}|${opts.to}`;
  // Pas de cache en test : chaque test mocke fetch() et attend une réponse déterministe.
  const bypassCache = process.env.NODE_ENV === "test";

  if (!bypassCache && cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
    return cache.data.filter((e) => opts.distances.includes(e.distance));
  }

  const raw = await fetchRaw(opts.from, opts.to);
  const data: AcpCatalogEvent[] = raw
    .filter((e) => e.Pays === "France")
    .map((e) => ({
      id: stableId(e),
      date: parseFrenchDate(e.Date),
      distance: e.Distance,
      ville: e.Ville,
      departement: e.Departement,
      region: e.Region,
      club: e.NomClub,
      contact: e.Contact,
      siteWeb: e.SiteWeb,
      roadMap: e.RoadMap,
      denivele: e.Denivele,
    }));

  if (!bypassCache) cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, data };
  return data.filter((e) => opts.distances.includes(e.distance));
}
