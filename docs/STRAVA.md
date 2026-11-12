# Onglet Strava (Profil)

## Mise en route

1. Créer une application sur https://www.strava.com/settings/api. « Authorization Callback Domain » = le domaine du site.
2. Renseigner dans `.env.production` : `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `PUBLIC_URL` (URL de rappel par défaut : `<PUBLIC_URL>/api/strava/callback`, ou `STRAVA_REDIRECT_URI`) et, pour les webhooks, `STRAVA_WEBHOOK_VERIFY_TOKEN` (valeur au choix).
3. Redéployer. Au démarrage, si le jeton webhook et `PUBLIC_URL` sont renseignés, l'abonnement webhook Strava est créé automatiquement (une seule fois par application).

Aucune clé d'IA n'est nécessaire : le Coach est un moteur de règles exécuté sur le serveur, les données de santé ne sont envoyées à aucun service tiers.

## Architecture

| Élément | Fichier |
|---|---|
| OAuth2, jetons, synchro, webhooks | `src/lib/strava.ts`, `src/routes/strava.ts` |
| Charge, zones, ACWR, forme/fatigue, semaines | `src/lib/stravaMetrics.ts` |
| Analyse et conseils (profil, ton, métriques) | `src/lib/stravaCoach.ts` |
| Bilans automatiques (cloche + Telegram) | `src/lib/coachReports.ts` |
| Interface | `web/src/components/strava/*`, onglet dans `web/src/pages/ProfilePage.tsx` |

- **Connexion** : `GET /api/strava/connect` renvoie l'URL d'autorisation (scopes `read,activity:read_all,profile:read_all`). Le retour `GET /api/strava/callback` identifie le compte par un `state` signé (HMAC, 10 min), car le cookie de session est `SameSite=Strict` et n'accompagne pas le retour depuis strava.com. Sans le scope `activity:read_all` (décoché par le sportif), la connexion est refusée.
- **Jetons** : chiffrés au repos (AES-256-GCM). Le jeton d'accès (6 h) est renouvelé automatiquement 5 min avant l'expiration ; le dernier `refresh_token` reçu est toujours conservé.
- **Synchronisation** : à la connexion, à la demande (bouton, 1 min de délai), toutes les 6 h pour tous les comptes, et en temps réel par webhook (création, modification, suppression d'une activité). Seules les sorties à vélo des 400 derniers jours sont gardées (pas de tracé GPS).
- **Déconnexion** : `POST /oauth/deauthorize` chez Strava puis effacement local des jetons et des activités (même si Strava est injoignable). Une déautorisation faite sur strava.com (événement webhook `authorized=false`) efface aussi les données, après vérification que le jeton est réellement révoqué (l'événement n'est pas signé).
- **Réglages du Coach** (`GET/PUT /api/strava/coach-prefs`) : profil, ton, fréquence des bilans, métriques, objectif. Bilans : après chaque sortie (webhook) ou le dimanche à partir de 18 h (Paris), une seule fois.

## Calculs (estimations)

- **Charge** d'une sortie ≈ TSS : `heures × 100 × IF²`, avec IF = puissance pondérée / FTP, sinon FC moyenne / (0,9 × FC max), sinon 0,65.
- **ACWR** = charge des 7 derniers jours ÷ moyenne hebdomadaire des 28 derniers jours (optimal 0,8-1,3 ; vigilance > 1,3 ; danger > 1,5).
- **Forme / fatigue / fraîcheur** : moyennes exponentielles de la charge (42 j / 7 j), fraîcheur = forme − fatigue.
- **Intensités** : la zone (1-5) d'une sortie est déduite de sa FC moyenne (zones Strava) ou de sa puissance moyenne ; une sortie à intervalles est donc lissée. Modèle à 3 zones : endurance Z1-Z2, tempo Z3, intense Z4-Z5.

## Connecteurs IA

Seuls Claude (Anthropic) et Google Gemini sont proposés, avec le serveur MCP Strava `https://mcp.strava.com/mcp` (lecture seule, abonnement Strava requis). Le test vérifie uniquement que le serveur MCP est joignable (un 401 est normal) : la liaison se fait dans l'assistant, ce site n'y a pas accès.
