// Récupère les statistiques publiques d'un parcours OpenRunner (distance, dénivelé)
// sans authentification. OpenRunner les intègre côté serveur dans le HTML, sous la
// forme d'un état Nuxt sérialisé : `window.__NUXT__=(function(a,b,c,...){ ...;
// ALIAS.length=204178;ALIAS.elevation={ascent:bw,descent:bw,...} })(val1,val2,...)`.
// Les valeurs répétées sont dédupliquées par Nuxt et référencées par un nom de
// variable plutôt que répétées en clair, d'où le besoin de résoudre ces références
// via les arguments de l'appel — mais JAMAIS en exécutant ce JS : uniquement par
// découpage de texte (comptage de profondeur de parenthèses/accolades, guillemets),
// pour ne jamais lancer du code tiers récupéré sur le réseau.

export interface OpenRunnerStats {
  name: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
}

export function extractOpenRunnerRouteId(url: string): string | null {
  const m = url.match(/openrunner\.com\/route-details\/(\d+)/i);
  return m ? m[1] : null;
}

function findMatchingClose(text: string, openIndex: number): number {
  const open = text[openIndex];
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : null;
  if (!close) throw new Error("not an opening bracket");
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      current += ch;
      if (ch === "\\") {
        current += text[++i];
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim());
}

type LiteralMap = Record<string, string>;

function parseLiteral(token: string | undefined, map: LiteralMap, depth = 0): unknown {
  if (depth > 5 || token === undefined) return undefined;
  token = token.trim();
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null" || token === "void 0" || token === "undefined") return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    const inner = token.slice(1, -1);
    try {
      return JSON.parse(`"${inner.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`);
    } catch {
      return inner;
    }
  }
  if (token.startsWith("{") && token.endsWith("}")) return parseObjectLiteral(token, map, depth + 1);
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) && Object.prototype.hasOwnProperty.call(map, token)) {
    return parseLiteral(map[token], map, depth + 1);
  }
  return undefined;
}

function parseObjectLiteral(text: string, map: LiteralMap, depth: number): Record<string, unknown> {
  const inner = text.slice(1, -1);
  const fields = splitTopLevel(inner);
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    const idx = field.indexOf(":");
    if (idx === -1) continue;
    const key = field.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    obj[key] = parseLiteral(field.slice(idx + 1), map, depth);
  }
  return obj;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function parseOpenRunnerHtml(html: string, routeId: string): OpenRunnerStats | null {
  const marker = "window.__NUXT__=(function(";
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const paramsStart = start + marker.length;
  const paramsEnd = html.indexOf(")", paramsStart);
  if (paramsEnd === -1) return null;
  const paramsText = html.slice(paramsStart, paramsEnd);

  const bodyOpen = html.indexOf("{", paramsEnd);
  if (bodyOpen === -1) return null;
  const bodyClose = findMatchingClose(html, bodyOpen);
  if (bodyClose === -1) return null;
  const bodyText = html.slice(bodyOpen + 1, bodyClose);

  const argsOpen = html.indexOf("(", bodyClose);
  if (argsOpen === -1) return null;
  const argsClose = findMatchingClose(html, argsOpen);
  if (argsClose === -1) return null;
  const argsText = html.slice(argsOpen + 1, argsClose);

  const params = paramsText.split(",").map((p) => p.trim());
  const args = splitTopLevel(argsText);
  const map: LiteralMap = {};
  for (let i = 0; i < params.length; i++) map[params[i]] = args[i] ?? "null";

  const idMatch = bodyText.match(new RegExp(`([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\\.id=${routeId};`));
  if (!idMatch) return null;
  const alias = idMatch[1];

  function field(name: string): unknown {
    const re = new RegExp(`${alias}\\.${name}=([^;]+);`);
    const m = bodyText.match(re);
    return m ? parseLiteral(m[1], map) : undefined;
  }

  const name = field("name");
  const length = field("length");
  const elevation = field("elevation") as { ascent?: unknown; descent?: unknown; min?: unknown; max?: unknown } | undefined;

  return {
    name: typeof name === "string" ? name : null,
    distanceKm: typeof length === "number" ? round1(length / 1000) : null,
    elevationGainM: typeof elevation?.ascent === "number" ? Math.round(elevation.ascent) : null,
    elevationLossM: typeof elevation?.descent === "number" ? Math.round(elevation.descent) : null,
    minAltitudeM: typeof elevation?.min === "number" ? Math.round(elevation.min) : null,
    maxAltitudeM: typeof elevation?.max === "number" ? Math.round(elevation.max) : null,
  };
}

const FETCH_TIMEOUT_MS = 10000;

export async function fetchOpenRunnerStats(url: string): Promise<OpenRunnerStats | null> {
  const routeId = extractOpenRunnerRouteId(url);
  if (!routeId) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.openrunner.com/route-details/${routeId}`, { signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    return parseOpenRunnerHtml(html, routeId);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
