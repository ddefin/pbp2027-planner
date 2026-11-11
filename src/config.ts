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
  // Toutes optionnelles : sans TELEGRAM_BOT_TOKEN, ni la diffusion des actualités, ni
  // les notifications personnalisées, ni la liaison de compte ne sont actives — le
  // reste de l'app fonctionne normalement (même logique que SMTP/OpenWeather plus haut).
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  // Chat/canal/groupe où sont diffusées les actualités ACP/PBP (voir
  // src/lib/newsScraper.ts) — distinct des messages privés de notification
  // personnalisée, qui vont au chat lié par chaque utilisateur (TelegramLink).
  telegramNewsChatId: process.env.TELEGRAM_NEWS_CHAT_ID || null,
  // Nom d'utilisateur du bot (sans @), pour générer un lien direct
  // https://t.me/<username>?start=<code> dans "Mon profil" — sans ça, l'utilisateur
  // doit chercher le bot à la main dans Telegram avant de coller le code.
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null,
  // Fréquence du scraping des actualités (voir le scheduler dans src/server.ts).
  newsScrapeIntervalHours: Number(process.env.NEWS_SCRAPE_INTERVAL_HOURS ?? 24),
};
