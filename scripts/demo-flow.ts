// Démo manuelle du flux complet: inscription -> login -> session -> logout.
// Usage: npm run demo (le serveur doit tourner sur PORT, voir .env)
import "dotenv/config";

const base = `http://localhost:${process.env.PORT ?? 3001}`;

async function main() {
  const email = `demo+${Date.now()}@example.com`;
  const password = "mot-de-passe-de-demo-123";

  console.log("1) Inscription");
  await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, prenom: "Demo" }),
  });

  console.log("2) Login");
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = loginRes.headers.get("set-cookie");
  console.log(await loginRes.json(), "cookie:", cookie);

  console.log("3) Session courante");
  const sessionRes = await fetch(`${base}/api/auth/session`, { headers: { cookie: cookie ?? "" } });
  console.log(await sessionRes.json());

  console.log("4) Logout");
  const logoutRes = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: cookie ?? "" } });
  console.log(await logoutRes.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
