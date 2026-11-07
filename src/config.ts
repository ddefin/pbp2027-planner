import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  mfaEncryptionKeyHex: required("MFA_ENCRYPTION_KEY"),
  totpIssuer: process.env.TOTP_ISSUER ?? "PBP2027 Planner",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  // Optionnelle : sans elle, /brm/:id/meteo répond juste "non configuré" plutôt que
  // d'empêcher le serveur de démarrer — la météo live n'est pas une fonctionnalité
  // critique.
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || null,
};
