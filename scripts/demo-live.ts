// Démo de la page de suivi des proches : crée un compte de démonstration, un brevet de
// ~600 km (trace simulée), les liens LiveTrack/Beacon, 3 pointages, et affiche le lien
// public à ouvrir. Données : docs/examples/live-demo.json.
//
// À lancer contre un serveur de TEST (jamais la production) :
//   BASE=http://localhost:3120 npx tsx scripts/demo-live.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Demo = {
  rider: { prenom: string; email: string; password: string };
  brevet: { title: string; classKm: number; limitMinutes: number; targetKm: number; startHoursAgo: number };
  route: { name: string; lat: number; lon: number; control?: boolean }[];
  checkins: { control: string; hoursAgo: number; status: string; message: string | null }[];
  links: { liveTrackUrl: string; beaconUrl: string };
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = JSON.parse(readFileSync(path.join(root, "docs/examples/live-demo.json"), "utf8")) as Demo;
const base = process.env.BASE ?? `http://localhost:${process.env.PORT ?? 3001}`;
if (!/localhost|127\.0\.0\.1/.test(base) && process.env.DEMO_FORCE !== "1") {
  console.error(`Refus : ${base} n'est pas un serveur local. Ce script est fait pour un serveur de test.`);
  process.exit(1);
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Trace simulée : on relie les villes avec des lacets (sinusoïde latérale) dont
// l'amplitude est ajustée pour obtenir la distance visée ; relief vallonné.
function buildTrack(amp: number) {
  const pts: { lat: number; lon: number; ele: number }[] = [];
  let k = 0;
  for (let i = 0; i < demo.route.length - 1; i++) {
    const a = demo.route[i];
    const b = demo.route[i + 1];
    const n = Math.max(40, Math.round(distKm(a, b) * 2));
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const len = Math.hypot(dLat, dLon);
    for (let j = 0; j < n; j++, k++) {
      const t = j / n;
      const off = amp * Math.sin(t * Math.PI * 14) * Math.sin(t * Math.PI);
      pts.push({
        lat: a.lat + dLat * t + (-dLon / len) * off,
        lon: a.lon + dLon * t + (dLat / len) * off,
        ele: Math.round(150 + 90 * Math.sin(k / 37) + 45 * Math.sin(k / 9) + 30 * Math.sin(k / 3.3)),
      });
    }
  }
  const last = demo.route[demo.route.length - 1];
  pts.push({ lat: last.lat, lon: last.lon, ele: 40 });
  return pts;
}
const length = (pts: { lat: number; lon: number }[]) => pts.slice(1).reduce((s, p, i) => s + distKm(pts[i], p), 0);

let lo = 0;
let hi = 0.3;
for (let i = 0; i < 30; i++) {
  const mid = (lo + hi) / 2;
  if (length(buildTrack(mid)) < demo.brevet.targetKm) lo = mid;
  else hi = mid;
}
const track = buildTrack(lo);
const wpts = demo.route
  .filter((w) => w.control !== false)
  .map((w) => `<wpt lat="${w.lat}" lon="${w.lon}"><name>${w.name}</name></wpt>`)
  .join("");
const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="demo">${wpts}<trk><name>${demo.brevet.title}</name><trkseg>${track
  .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele}</ele></trkpt>`)
  .join("")}</trkseg></trk></gpx>`;

async function api(pathname: string, init: RequestInit & { cookie?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body && typeof init.body === "string") headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api${pathname}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${pathname} → ${res.status} ${text}`);
  return { res, json: text ? JSON.parse(text) : null };
}

async function main() {
  const { rider, brevet, links } = demo;
  await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rider) });
  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: rider.email, password: rider.password }) });
  const cookie = (login.res.headers.get("set-cookie") ?? "").split(";")[0];

  const form = new FormData();
  form.append("file", new Blob([gpx], { type: "application/gpx+xml" }), "brm-600-demo.gpx");
  const up = await api("/roadbooks", { method: "POST", body: form, cookie });
  const rb = up.json.roadbook as { id: string; distanceKm: number; controls: { name: string; km: number }[] };
  const startAt = new Date(Date.now() - brevet.startHoursAgo * 3_600_000);
  await api(`/roadbooks/${rb.id}`, {
    method: "PATCH",
    cookie,
    body: JSON.stringify({ title: brevet.title, classKm: brevet.classKm, limitMinutes: brevet.limitMinutes, startAt: startAt.toISOString(), ...links, telegramAnnounce: false }),
  });

  for (const c of demo.checkins) {
    const ctrl = rb.controls.find((x) => x.name === c.control);
    if (!ctrl) throw new Error(`Contrôle introuvable : ${c.control}`);
    await api(`/roadbooks/${rb.id}/checkins`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ km: ctrl.km, source: "controle", status: c.status, message: c.message, at: new Date(Date.now() - c.hoursAgo * 3_600_000).toISOString(), announce: false }),
    });
  }
  const share = await api(`/roadbooks/${rb.id}/share`, { method: "POST", cookie, body: JSON.stringify({ enabled: true }) });
  console.log(`Brevet de démonstration : ${Math.round(rb.distanceKm)} km, ${rb.controls.length} contrôles, ${demo.checkins.length} pointages.`);
  console.log(`Page des proches : ${base}/r/${share.json.shareToken}`);
  console.log(`Roadbook (compte ${rider.email}) : ${base}/roadbooks/${rb.id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
