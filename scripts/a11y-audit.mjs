// Audit d'accessibilité (axe-core, WCAG 2.2 AA) des pages principales, à lancer contre un
// serveur LOCAL de test. Outils installés à la demande, hors des dépendances du projet
// (ils alourdiraient l'image Docker) :
//   npm install --no-save playwright axe-core && npx playwright install chromium
//   BASE=http://localhost:3001 EMAIL=… PASSWORD=… [SHARE=<jeton>] [ROADBOOK=<id>] node scripts/a11y-audit.mjs
// Code de sortie 1 s'il reste une violation « serious » ou « critical ».
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE ?? "http://localhost:3001";
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error("Ce script est fait pour un serveur local de test.");
  process.exit(2);
}
const anon = ["/login", "/inscription", "/mot-de-passe-oublie", ...(process.env.SHARE ? [`/r/${process.env.SHARE}`] : [])];
const rb = process.env.ROADBOOK;
const member = ["/", "/calendrier", "/parcours-pbp", "/roadbooks", ...(rb ? [`/roadbooks/${rb}`, `/roadbooks/${rb}#partage`] : []), "/carte-groupe", "/actualites", "/messagerie", "/profil", "/profil#strava"];

const browser = await chromium.launch();
let serious = 0;
for (const [who, list] of [["anonyme", anon], ["membre", member]]) {
  if (who === "membre" && !process.env.EMAIL) continue;
  for (const [viewport, colorScheme] of [[{ width: 390, height: 844 }, "light"], [{ width: 1280, height: 900 }, "light"], [{ width: 1280, height: 900 }, "dark"]]) {
    const ctx = await browser.newContext({ viewport, colorScheme, serviceWorkers: "block" });
    const page = await ctx.newPage();
    if (who === "membre") {
      await page.goto(`${BASE}/login`);
      await page.locator("input").first().fill(process.env.EMAIL);
      await page.locator("input[type=password]").first().fill(process.env.PASSWORD ?? "");
      await page.locator("button[type=submit]").first().click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    }
    for (const path of list) {
      await page.goto(BASE + path);
      await page.waitForTimeout(1500);
      for (const h of await page.locator('.disc-head[aria-expanded="false"]').all()) await h.click({ timeout: 800 }).catch(() => {});
      await page.addScriptTag({ content: AXE });
      const violations = await page.evaluate(async () => {
        // @ts-expect-error axe injecté dans la page
        const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, first: v.nodes[0]?.target.join(" ") }));
      });
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      serious += bad.length;
      console.log(`${bad.length ? "✗" : "✓"} ${who} ${viewport.width}px ${colorScheme} ${path}${violations.length ? " — " + violations.map((v) => `${v.id} (${v.impact}, ${v.n}) ${v.first ?? ""}`).join(" | ") : ""}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exit(serious ? 1 : 0);
