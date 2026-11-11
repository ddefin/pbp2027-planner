import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-roadbook-telegram.db");
const uploadsDir = path.resolve(repoRoot, "data-test-rb-telegram");
const CHANNEL = "-1009999999999";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let situationLib: typeof import("../src/lib/roadbookSituation.js");
let bot: typeof import("../src/lib/telegramBot.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true });
}

// Ligne droite de 200 km plein ouest depuis (48, 2), avec relief, et un CP au km 50.
const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
const lonAt = (km: number) => 2 - km / KM_PER_DEG_LON;
function straightGpx(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 2000; i++) {
    const km = i / 10;
    pts.push(`<trkpt lat="48" lon="${lonAt(km).toFixed(6)}"><ele>${(100 + 50 * Math.sin(km / 8)).toFixed(1)}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48.0005" lon="${lonAt(50)}"><name>CP1 Bourg</name></wpt><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

// Prévisions : vent d'ouest (on roule vers l'ouest → vent de face), pluie probable.
function owmForecast() {
  return {
    city: { name: "Villeprévi" },
    list: Array.from({ length: 40 }, (_, i) => ({
      dt: Math.floor((Date.now() - 3600_000 + i * 3 * 3600_000) / 1000),
      main: { temp: 13, feels_like: 10 },
      wind: { speed: 7, deg: 270, gust: 12 },
      weather: [{ description: "averses", icon: "10d" }],
      pop: 0.7,
      rain: { "3h": 2.4 },
    })),
  };
}

let sent: { chatId: string; text: string }[] = [];
// Réponse d'erreur réelle de l'API Telegram quand le bot ne peut pas écrire dans le canal.
let channelError: string | null = null;

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "77".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_TRACKING_CHAT_ID = CHANNEL;
  process.env.OPENWEATHER_API_KEY = "test-key";
  process.env.PUBLIC_URL = "https://pbp.example";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  situationLib = await import("../src/lib/roadbookSituation.js");
  bot = await import("../src/lib/telegramBot.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  sent = [];
  channelError = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body));
        if (channelError && String(body.chat_id) === CHANNEL) {
          return new Response(JSON.stringify({ ok: false, error_code: 400, description: channelError }), { status: 400 });
        }
        sent.push({ chatId: String(body.chat_id), text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      if (u.includes("/geo/1.0/reverse")) return new Response(JSON.stringify([{ name: "Bourg", local_names: { fr: "Bourg-la-Forêt" } }]), { status: 200 });
      if (u.includes("openweathermap")) return new Response(JSON.stringify(owmForecast()), { status: 200 });
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Calcul de la situation", () => {
  const points = Array.from({ length: 201 }, (_, i) => ({ lat: 48, lon: lonAt(i), ele: 100, distKm: i }));
  const rb = {
    classKm: 200,
    limitMinutes: 810,
    movingSpeedKmh: 25,
    climbPenaltyMinPer100m: 0,
    startAt: new Date("2027-03-06T06:00:00Z"),
    controls: [
      { name: "Départ", km: 0, stopMinutes: 0 },
      { name: "CP1", km: 50, stopMinutes: 20 },
      { name: "CP2", km: 120, stopMinutes: 30 },
      { name: "Arrivée", km: 200, stopMinutes: 0 },
    ],
    points,
  };

  it("donne km parcourus/restants, moyennes avec et sans pauses, arrivée prévue et délai", () => {
    const at = new Date("2027-03-06T10:20:00Z"); // 4h20 après le départ, au km 100
    const s = situationLib.computeSituation(rb, 100, at);
    expect(s.kmLeft).toBe(100);
    expect(s.avgAllKmh).toBeCloseTo(100 / (260 / 60), 2); // 23,1 km/h pauses comprises
    expect(s.avgMovingKmh).toBeCloseTo(100 / (240 / 60), 2); // 20 min de pause à CP1 déduites → 25 km/h
    expect(s.lastControl?.name).toBe("CP1");
    expect(s.nextControl?.name).toBe("CP2");
    // Reste : 20 km jusqu'à CP2 (48 min) + 30 min de pause + 80 km (3h12) = 4h30.
    expect(s.plannedFinishAt?.toISOString()).toBe("2027-03-06T14:50:00.000Z");
    expect(s.limitAt?.toISOString()).toBe("2027-03-06T19:30:00.000Z");
    expect(s.status?.planDeltaMin).toBe(0 + Math.round(4 * 60 + 20 - 260)); // pile dans son plan
  });

  it("met en forme un message complet, et échappe ce qui vient des utilisateurs", () => {
    const at = new Date("2027-03-06T10:20:00Z");
    const base = situationLib.computeSituation(rb, 100, at);
    const slot = { at: at.toISOString(), tempC: 12, feelsLikeC: 9, description: "pluie", icon: "10d", windSpeedKmh: 25, windGustsKmh: 40, windFromDeg: 270, precipitationProbability: 0.8, rainMm: 3 };
    const msg = situationLib.formatSituationMessage(
      { ...base, place: "Dourdan", weather: [{ label: "Maintenant", km: 100, at, slot, relation: "face", alongKmh: -25, alerts: ["vent_de_face", "pluie"] }] },
      { author: "Didier", title: "BRM <200>", classKm: 200, limitMinutes: 810, liveTrackUrl: "https://livetrack.garmin.com/session/abc/token/xyz", shareUrl: "https://pbp.example/r/tok" },
    );
    expect(msg).toContain("km 100</b> / 200");
    expect(msg).toContain("reste <b>100 km</b>");
    expect(msg).toContain("près de <b>Dourdan</b>");
    expect(msg).toContain("pauses comprises");
    expect(msg).toContain("hors pauses");
    expect(msg).toContain("Arrivée estimée");
    expect(msg).toContain("montées comprises");
    expect(msg).toContain("Délais BRM 200");
    expect(msg).toContain("ferme à");
    expect(msg).toContain("vent 25–40 km/h de face");
    expect(msg).toContain("⚠️ vent de face, pluie");
    expect(msg).toContain('href="https://livetrack.garmin.com/session/abc/token/xyz"');
    expect(msg).toContain("BRM &lt;200&gt;");
    expect(msg).not.toContain("BRM <200>");
  });
});

describe("Pointage depuis Telegram", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let roadbookId: string;
  const CHAT = "424242";

  const msg = (m: { text?: string; location?: { latitude: number; longitude: number }; type?: string }) =>
    bot.handleTelegramUpdate({ update_id: 1, message: { chat: { id: Number(CHAT), type: m.type ?? "private" }, text: m.text, location: m.location } });

  beforeAll(async () => {
    server = buildServer();
    const email = `tg-rb-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];

    const boundary = "----tg" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BRM 200.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
      Buffer.from(straightGpx()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    roadbookId = up.json().roadbook.id;
    await server.inject({
      method: "PATCH",
      url: `/api/roadbooks/${roadbookId}`,
      headers: { cookie },
      payload: { startAt: new Date(Date.now() - 3 * 3600_000).toISOString(), movingSpeedKmh: 25 },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.telegramLink.create({ data: { userId: user.id, chatId: CHAT } });
  });

  it("ignore les messages venant d'un groupe ou d'un canal", async () => {
    await msg({ text: "/km 10", type: "group" });
    expect(sent).toEqual([]);
  });

  it("refuse un compte non lié", async () => {
    await bot.handleTelegramUpdate({ update_id: 2, message: { chat: { id: 999, type: "private" }, text: "/km 10" } });
    expect(sent[0].text).toContain("pas encore lié");
  });

  it("pointe une position GPS, répond en privé et publie le résumé sur le canal", async () => {
    await msg({ location: { latitude: 48.001, longitude: lonAt(62) } });
    const channel = sent.find((m) => m.chatId === CHANNEL);
    const priv = sent.find((m) => m.chatId === CHAT);
    expect(Number(/<b>km ([\d,]+)<\/b>/.exec(channel!.text)![1].replace(",", "."))).toBeCloseTo(62, 0);
    expect(channel?.text).toContain("Bourg-la-Forêt");
    expect(channel?.text).toContain("de face"); // vent d'ouest, route vers l'ouest
    expect(channel?.text).toContain("Arrivée estimée");
    expect(priv?.text).toContain("publié sur le canal");
    const last = await prisma.roadbookCheckin.findFirst({ where: { roadbookId }, orderBy: { at: "desc" } });
    expect(last?.source).toBe("gps");
    expect(last?.km).toBeCloseTo(62, 0);
  });

  it("n'inonde pas le canal en cas de double pointage rapproché, mais répond toujours", async () => {
    await msg({ text: "/km 64" });
    expect(sent.some((m) => m.chatId === CHANNEL)).toBe(false);
    expect(sent.find((m) => m.chatId === CHAT)?.text).toContain("km 64");
  });

  it("liste et pointe les contrôles avec /cp", async () => {
    await msg({ text: "/cp" });
    expect(sent[0].text).toContain("/cp 1</code> — CP1 Bourg");
    sent = [];
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await msg({ text: "/cp 1" });
    const cpMsg = sent.find((m) => m.chatId === CHANNEL)!.text;
    expect(Number(/<b>km ([\d,]+)<\/b>/.exec(cpMsg)![1].replace(",", "."))).toBeCloseTo(50, 0);
  });

  it("refuse une position trop loin du tracé", async () => {
    await msg({ location: { latitude: 45.76, longitude: 4.83 } }); // Lyon
    expect(sent[0].text).toContain("pointage non enregistré");
  });

  it("ne publie rien sur le canal quand le randonneur l'a désactivé", async () => {
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${roadbookId}`, headers: { cookie }, payload: { telegramAnnounce: false } });
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await msg({ text: "/km 80" });
    expect(sent.some((m) => m.chatId === CHANNEL)).toBe(false);
    expect(sent[0].text).toContain("publication sur le canal désactivée");
  });

  it("n'accepte qu'un lien LiveTrack Garmin, et le montre sur le lien de suivi", async () => {
    const bad = await server.inject({ method: "PATCH", url: `/api/roadbooks/${roadbookId}`, headers: { cookie }, payload: { liveTrackUrl: "https://evil.example/garmin" } });
    expect(bad.statusCode).toBe(400);
    const ok = await server.inject({
      method: "PATCH",
      url: `/api/roadbooks/${roadbookId}`,
      headers: { cookie },
      payload: { liveTrackUrl: "https://livetrack.garmin.com/session/abc/token/xyz" },
    });
    expect(ok.json().roadbook.liveTrackUrl).toBe("https://livetrack.garmin.com/session/abc/token/xyz");

    const share = await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/share`, headers: { cookie }, payload: { enabled: true } });
    const pub = await server.inject({ method: "GET", url: `/api/roadbooks/shared/${share.json().shareToken}` });
    expect(pub.json().roadbook.liveTrackUrl).toContain("livetrack.garmin.com");
    expect(pub.body).not.toContain("telegramAnnounce");
    expect(pub.body).not.toContain("announceStatus");
  });

  it("dit la vérité quand Telegram refuse la publication, et garde le motif dans le roadbook", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null, telegramAnnounce: true } });
    channelError = "Forbidden: bot is not a member of the channel chat";
    await msg({ text: "/km 70" });
    const reply = sent.find((m) => m.chatId === CHAT)!.text;
    expect(reply).toContain("PAS publié sur le canal");
    expect(reply).toContain("bot is not a member");
    expect(reply).toContain("ADMINISTRATEUR du canal");
    expect(reply).not.toContain("✅ Pointage enregistré et publié");

    const detail = await server.inject({ method: "GET", url: `/api/roadbooks/${roadbookId}`, headers: { cookie } });
    expect(detail.json().roadbook.announceStatus.lastError).toContain("not a member");
    expect(detail.json().roadbook.announceStatus.hint).toContain("ADMINISTRATEUR");
  });

  it("propose à l'admin un test du canal qui renvoie la réponse exacte de Telegram", async () => {
    await prisma.user.updateMany({ data: { isAdmin: true } });
    channelError = "Bad Request: chat not found";
    const ko = await server.inject({ method: "POST", url: "/api/roadbooks/telegram/test", headers: { cookie } });
    expect(ko.json()).toMatchObject({ ok: false, chatId: CHANNEL, error: "Bad Request: chat not found" });
    expect(ko.json().hint).toContain("TELEGRAM_TRACKING_CHAT_ID");

    channelError = null;
    const ok = await server.inject({ method: "POST", url: "/api/roadbooks/telegram/test", headers: { cookie } });
    expect(ok.json().ok).toBe(true);
    expect(sent.find((m) => m.chatId === CHANNEL)?.text).toContain("Test de publication");
  });

  it("publie aussi le résumé quand on pointe depuis le site", async () => {
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${roadbookId}`, headers: { cookie }, payload: { telegramAnnounce: true } });
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie }, payload: { km: 95, source: "manuel" } });
    await vi.waitFor(() => expect(sent.some((m) => m.chatId === CHANNEL)).toBe(true));
    expect(sent.find((m) => m.chatId === CHANNEL)?.text).toContain("Garmin LiveTrack");
  });
});
