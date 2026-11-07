// Démo manuelle du flux complet: inscription -> activation MFA -> login + MFA -> logout.
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
    body: JSON.stringify({ email, password }),
  });

  console.log("2) Login sans MFA (encore désactivée)");
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = loginRes.headers.get("set-cookie");
  console.log(await loginRes.json(), "cookie:", cookie);

  console.log("3) Setup MFA (nécessite d'être connecté)");
  const setupRes = await fetch(`${base}/api/auth/mfa/setup`, {
    method: "POST",
    headers: { cookie: cookie ?? "" },
  });
  const { secret, otpauthUri } = (await setupRes.json()) as { secret: string; otpauthUri: string };
  console.log({ secret, otpauthUri });
  console.log("-> Ajoute ce secret dans ton app d'authentification pour continuer le test manuellement.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
