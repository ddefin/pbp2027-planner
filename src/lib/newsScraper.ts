import * as cheerio from "cheerio";
import { prisma } from "../db.js";
import { escapeHtml, sendTelegramNewsMessage } from "./telegram.js";

export const NEWS_SOURCES = ["acp", "pbp"] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];

const SOURCE_META: Record<NewsSource, { url: string; label: string }> = {
  acp: { url: "https://www.audax-club-parisien.com/actualites/", label: "Audax Club Parisien" },
  pbp: { url: "https://www.paris-brest-paris.org/actualites/", label: "Paris-Brest-Paris" },
};

const FETCH_TIMEOUT_MS = 15_000;

// Les deux sites sources affichent leurs dates en français ("30 octobre 2026",
// "9 novembre 2026") : pas de format ISO à parser, juste ce vocabulaire fixe.
const FR_MONTHS: Record<string, number> = {
  janvier: 0,
  février: 1,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  décembre: 11,
  decembre: 11,
};

// Retombe sur la date du jour si le format venait à changer côté source : un
// article mal daté reste préférable à un scraping qui échoue en bloc pour tous
// les autres articles de la page.
function parseFrenchDate(text: string): Date {
  const m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(text.trim().toLowerCase());
  if (!m) return new Date();
  const month = FR_MONTHS[m[2]];
  if (month === undefined) return new Date();
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

function cleanText(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

type ScrapedItem = { title: string; url: string; excerpt: string; publishedAt: Date; imageUrl: string | null };

// Audax Club Parisien : thème WordPress Astra, chaque actualité est un
// <article class="... ast-article-post">. Voir doc en commentaire de NewsItem.
function scrapeAcp(html: string): ScrapedItem[] {
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];
  $("article.ast-article-post").each((_, el) => {
    const titleLink = $(el).find("h2.entry-title a").first();
    const title = cleanText(titleLink.text());
    const url = titleLink.attr("href");
    if (!title || !url) return;
    const dateText = cleanText($(el).find(".posted-on .published").first().text());
    const excerpt = cleanText($(el).find(".ast-excerpt-container p").first().text());
    items.push({ title, url, excerpt, publishedAt: parseFrenchDate(dateText), imageUrl: null });
  });
  return items;
}

// Paris-Brest-Paris : gabarit maison, chaque actualité est un
// <article class="tease tease-post"> avec des classes news-card__*.
function scrapePbp(html: string): ScrapedItem[] {
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];
  $("article.tease-post").each((_, el) => {
    const title = cleanText($(el).find(".news-card__title").first().text());
    const url = $(el).find(".news-card__link").first().attr("href");
    if (!title || !url) return;
    const dateText = cleanText($(el).find(".news-card__date").first().text());
    const excerpt = cleanText($(el).find(".news-card__excerpt").first().text());
    const imageUrl = $(el).find(".news-card__image img").first().attr("src") ?? null;
    items.push({ title, url, excerpt, publishedAt: parseFrenchDate(dateText), imageUrl });
  });
  return items;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; PBP2027Planner/1.0; +https://pbp2027.lameteoducyclo.fr)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Récupère les deux pages sources, insère les articles pas encore vus
// (dédoublonné par URL, voir le modèle NewsItem — la contrainte unique fait le
// travail, pas une vérification préalable qui serait sujette à une course) et
// diffuse chacun sur Telegram dès son insertion. Pensé pour tourner une fois
// par jour (voir le scheduler dans src/server.ts), mais aussi appelable à la
// demande (route admin de test, voir src/routes/news.ts).
export async function scrapeNews(): Promise<{ added: number; checked: number }> {
  let added = 0;
  let checked = 0;

  for (const source of NEWS_SOURCES) {
    const { url, label } = SOURCE_META[source];
    const html = await fetchHtml(url);
    if (!html) continue;

    const items = source === "acp" ? scrapeAcp(html) : scrapePbp(html);
    checked += items.length;

    for (const item of items) {
      let created;
      try {
        created = await prisma.newsItem.create({
          data: {
            source,
            title: item.title,
            url: item.url,
            excerpt: item.excerpt || null,
            imageUrl: item.imageUrl,
            publishedAt: item.publishedAt,
          },
        });
      } catch {
        continue; // url déjà en base (contrainte unique) : pas une nouvelle actualité
      }
      added++;

      const text = `📰 <b>${escapeHtml(label)}</b>\n${escapeHtml(created.title)}\n${created.url}`;
      await sendTelegramNewsMessage(text).catch(() => undefined);
    }
  }

  await syncNewsNotifications().catch((err) => console.error("[news] notifications impossibles :", err));
  return { added, checked };
}

const NEWS_NOTIFY_DAYS = 7;

// Cloche de l'app : une notification par compte pour chaque actualité PUBLIÉE depuis
// moins de 7 jours. Idempotent (un compte ne reçoit jamais deux fois la même), ce qui
// rattrape aussi une actualité déjà en base avant cette fonctionnalité et les comptes
// créés après. Le plafond de 7 jours évite d'inonder la cloche au premier passage sur
// une base vide (le scraping remonte alors tout l'historique des sites sources).
export async function syncNewsNotifications(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - NEWS_NOTIFY_DAYS * 86_400_000);
  const items = await prisma.newsItem.findMany({ where: { publishedAt: { gte: since } }, orderBy: { publishedAt: "asc" } });
  if (items.length === 0) return 0;
  const users = await prisma.user.findMany({ select: { id: true } });
  let created = 0;
  for (const item of items) {
    const message = `📰 ${SOURCE_META[item.source as NewsSource]?.label ?? "Actualité"} : ${item.title}`;
    const already = await prisma.notification.findMany({ where: { kind: "news", message }, select: { userId: true } });
    const have = new Set(already.map((n) => n.userId));
    const missing = users.filter((u) => !have.has(u.id));
    if (missing.length === 0) continue;
    await prisma.notification.createMany({ data: missing.map((u) => ({ userId: u.id, kind: "news", message, link: "/actualites" })) });
    created += missing.length;
  }
  return created;
}
