import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  // Nom historique (venait de la double authentification, retirée depuis) : sert
  // maintenant à chiffrer au repos les secrets de webhook "generic" (voir
  // src/lib/secretCrypto.ts) — pas renommé pour ne pas casser les .env.production
  // déjà déployés.
  mfaEncryptionKeyHex: required("MFA_ENCRYPTION_KEY"),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  // Optionnelle : sans elle, /brm/:id/meteo répond juste "non configuré" plutôt que
  // d'empêcher le serveur de démarrer — la météo live n'est pas une fonctionnalité
  // critique.
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || null,
  // Optionnelle elle aussi : sans elle, /auth/forgot-password répond "non configuré"
  // plutôt que d'empêcher le serveur de démarrer — réinitialiser son mot de passe par
  // email n'est pas requis pour que le reste de l'app fonctionne. Une boîte mail
  // existante (ex. SMTP OVH), pas un service tiers à créer.
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        password: process.env.SMTP_PASSWORD ?? "",
        from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
      }
    : null,
  // Seuil (km/h, vitesse soutenue OU rafales) au-delà duquel un BRM choisi dans
  // les 5 prochains jours (limite de l'API prévisions gratuite) déclenche
  // l'événement webhook "meteo.vent_fort" — voir src/lib/windAlerts.ts.
  windAlertThresholdKmh: Number(process.env.WIND_ALERT_THRESHOLD_KMH ?? 50),
  // D'où partent les liens de réinitialisation (ex. https://pbp2027.lameteoducyclo.fr) :
  // sans elle, dérivé de l'en-tête Host de la requête (voir src/routes/auth.ts).
  publicUrl: process.env.PUBLIC_URL || null,
};
