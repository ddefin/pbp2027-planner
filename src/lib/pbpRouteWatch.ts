import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { prisma } from "../db.js";
import { escapeHtml, sendTelegramNewsMessage } from "./telegram.js";

// Surveille la page « Parcours » du site officiel : tant qu'elle affiche « Retrouvez
// bientôt tous les liens vers les fichiers GPX », le tracé officiel n'est pas publié.
// Dès que cette mention disparaît ou que des liens GPX/cartes apparaissent, on prévient.

export const PBP_ROUTE_PAGE = "https://www.paris-brest-paris.org/parcours/";
const KEY = "pbp-route";
const FETCH_TIMEOUT_MS = 15_000;
const PENDING_MARKER = /retrouvez bient[oô]t tous les liens vers les fichiers gpx/i;
const ROUTE_LINK = /\.(gpx|kml|kmz)(\?|$)|openrunner|strava\.com\/routes|komoot|ridewithgps|google\.[a-z.]+\/maps|mapy\.cz|umap/i;

export interface PageAnalysis {
  contentHash: string;
  routePending: boolean;
  routeLinks: string[];
}

export function analyzeRoutePage(html: string): PageAnalysis {
  const $ = cheerio.load(html);
  const main = $("main").length ? $("main") : $("body");
  const text = main.text().replace(/\s+/g, " ").trim();
  const links = new Set<string>();
  main.find("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^https?:\/\//i.test(href) && ROUTE_LINK.test(href)) links.add(href);
  });
  return {
    contentHash: createHash("sha256").update(text).digest("hex"),
    routePending: PENDING_MARKER.test(text),
    routeLinks: [...links].sort(),
  };
}

async function fetchPage(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PBP_ROUTE_PAGE, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; PBP2027Planner/1.0)" },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Notification à tous les comptes admin (cloche de l'app) + canal actualités Telegram.
async function announce(message: string, telegramHtml: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } });
  for (const a of admins) {
    await prisma.notification.create({ data: { userId: a.id, kind: "pbp_route", message, link: "/parcours-pbp" } });
  }
  await sendTelegramNewsMessage(telegramHtml).catch(() => undefined);
}

export interface WatchResult {
  checked: boolean;
  routePublished: boolean;
  notified: boolean;
}

export async function checkOfficialRoute(): Promise<WatchResult> {
  const html = await fetchPage();
  if (!html) return { checked: false, routePublished: false, notified: false };
  const now = new Date();
  const a = analyzeRoutePage(html);
  const prev = await prisma.watchedPage.findUnique({ where: { key: KEY } });

  const prevLinks: string[] = prev ? JSON.parse(prev.routeLinks) : [];
  const newLinks = a.routeLinks.filter((l) => !prevLinks.includes(l));
  const becameAvailable = Boolean(prev && prev.routePending && !a.routePending);
  // Première lecture : on mémorise l'état sans notifier (sinon alerte à tort au déploiement).
  const shouldNotify = Boolean(prev) && (becameAvailable || newLinks.length > 0);

  await prisma.watchedPage.upsert({
    where: { key: KEY },
    create: { key: KEY, contentHash: a.contentHash, routePending: a.routePending, routeLinks: JSON.stringify(a.routeLinks), checkedAt: now },
    update: {
      contentHash: a.contentHash,
      routePending: a.routePending,
      routeLinks: JSON.stringify(a.routeLinks),
      checkedAt: now,
      ...(prev && prev.contentHash !== a.contentHash ? { changedAt: now } : {}),
      ...(shouldNotify ? { lastNotifiedAt: now } : {}),
    },
  });

  if (shouldNotify) {
    const links = a.routeLinks.map((l) => `• <a href="${escapeHtml(l)}">${escapeHtml(l)}</a>`).join("\n");
    await announce(
      "🗺️ Le parcours officiel de Paris-Brest-Paris 2027 semble publié sur le site de l'organisation : importe-le dans la page Parcours PBP.",
      `🗺️ <b>Parcours officiel PBP 2027 : publié ?</b>\nLa page « Parcours » du site de l'organisation a changé : les fichiers GPX semblent disponibles.\n${links ? `\n${links}\n` : ""}\n<a href="${PBP_ROUTE_PAGE}">Voir la page officielle</a>`,
    );
  }
  return { checked: true, routePublished: !a.routePending || a.routeLinks.length > 0, notified: shouldNotify };
}

export async function officialRouteState() {
  const w = await prisma.watchedPage.findUnique({ where: { key: KEY } });
  if (!w) return null;
  return {
    pending: w.routePending && JSON.parse(w.routeLinks).length === 0,
    links: JSON.parse(w.routeLinks) as string[],
    checkedAt: w.checkedAt.toISOString(),
    pageUrl: PBP_ROUTE_PAGE,
  };
}
