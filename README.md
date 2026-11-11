# PBP 2027 Planner — backend

Service d'authentification et de suivi BRM pour le planner de qualification
Paris-Brest-Paris 2027.
Dépôt séparé de `lameteoducyclo.fr` (repo `meteo-velo`) — aucun impact sur le site météo existant.

## Choix de sécurité

- **Mots de passe** : `scrypt` (node:crypto, pas de dépendance tierce), sel aléatoire par utilisateur, comparaison en temps constant.
- **Sessions** : cookie `httpOnly`, `SameSite=Strict`, jeton opaque de 256 bits ; seul le hash SHA-256 du jeton est stocké en base (une fuite de la base ne permet pas de rejouer une session). Expiration glissante sur 30 jours.
- **Verrouillage de compte** : après 8 échecs de mot de passe, compte verrouillé 15 minutes.
- **Rate limiting** : 10 tentatives de login / 15 min par IP (en mémoire ; à migrer vers un backend partagé type Redis en cas de plusieurs instances).
- **Énumération de comptes** : `/api/auth/register` et les échecs de `/api/auth/login` renvoient des réponses génériques.
- **Toutes les routes sont sous `/api`** : évite toute collision avec les routes côté client du frontend (ex. `/messagerie` existe à la fois côté API et côté React Router — sans préfixe, un rechargement de page sur cette URL serait intercepté par le proxy et renverrait la réponse JSON au lieu de l'app).

## Démarrer en local

```bash
cp .env.example .env
# openssl rand -hex 32  → colle le résultat dans MFA_ENCRYPTION_KEY (chiffre les
# secrets de webhook, nom historique — voir src/lib/secretCrypto.ts)
npm install
npm run prisma:migrate
npm run dev
```

Le service écoute sur `http://localhost:3001`.

## Endpoints

### Auth

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Création de compte (email + mot de passe) |
| POST | `/api/auth/login` | Vérifie le mot de passe, ouvre la session |
| GET  | `/api/auth/session` | (authentifié) Infos de session courante |
| POST | `/api/auth/logout` | Détruit la session courante |
| POST | `/api/auth/sessions/revoke-others` | (authentifié) Déconnecte toutes les autres sessions de l'utilisateur |

### BRM personnels

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/brm` | (authentifié) Liste les BRM suivis par l'utilisateur |
| POST | `/api/brm` | Ajoute un BRM (distance, date, lieu — limite ACP par défaut selon la distance) |
| PATCH | `/api/brm/:id` | Met à jour un BRM (statut, temps réalisé, …) |
| DELETE | `/api/brm/:id` | Supprime un BRM |

### Calendrier officiel ACP (partagé entre utilisateurs)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/brm/catalog` | BRM officiels France, 200-600km, 1er janvier-30 juin 2027 (lu en direct sur l'API ACP, caché 1h), avec le choix de chaque utilisateur |
| PUT | `/api/brm/catalog/:id/participation` | Choisit un statut (prévu/inscrit/fait/homologué) sur un BRM du calendrier |
| DELETE | `/api/brm/catalog/:id/participation` | Retire son choix |

### Webhooks

Notifications de groupe (Discord, Slack, ou un point de terminaison à soi en JSON signé HMAC-SHA256) déclenchées sur `brm.participation_changed` et `meteo.vent_fort`. Un abonnement est diffusé pour tout le monde dès qu'il écoute l'événement, pas seulement pour celui qui l'a configuré — c'est pensé pour un salon Discord/Slack partagé par le groupe, pas des notifications privées.

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/webhooks` | Liste les webhooks de l'utilisateur |
| POST | `/api/webhooks` | Crée un webhook (`url` en https, `format` discord/slack/generic, `events[]`). Pour `generic`, renvoie un `secret` une seule fois (signature HMAC des envois suivants) |
| PATCH | `/api/webhooks/:id` | Active/désactive, change les événements écoutés |
| DELETE | `/api/webhooks/:id` | Supprime le webhook |
| POST | `/api/webhooks/:id/test` | Envoie un événement de test à ce seul webhook (jamais une diffusion de groupe) |

La livraison ne bloque jamais la requête HTTP qui déclenche l'événement (pas d'`await` dans la route) : un webhook lent ou en échec n'affecte jamais l'action de l'utilisateur.

### Parcours (un par BRM personnel)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/brm/:brmEventId/parcours` | Parcours associé à ce BRM (`null` si aucun) |
| PUT | `/api/brm/:brmEventId/parcours` | Enregistre `sourceUrl` (tente une récupération automatique immédiate) et les notes |
| POST | `/api/brm/:brmEventId/parcours/upload` | Upload un `.gpx` (multipart), en calcule distance/D+/D- |
| GET | `/api/brm/:brmEventId/parcours/file` | Télécharge le GPX stocké |
| DELETE | `/api/brm/:brmEventId/parcours/file` | Retire le fichier (garde le reste du parcours) |

La récupération automatique ne marche actuellement que pour OpenRunner : `src/lib/openrunner.ts` lit les stats (distance, dénivelé) directement dans le HTML public de la page du parcours — OpenRunner les y intègre côté serveur, sans authentification. **Important** : ça ne passe jamais par une exécution du JS récupéré (pas de `vm`/`eval`), seulement par du découpage de texte qui résout les valeurs dédupliquées par Nuxt via les arguments de l'IIFE. Si OpenRunner change la forme de cette page, cette extraction casse silencieusement (elle renvoie juste `null`, jamais une erreur) et il faut uploader le GPX manuellement — exactement le repli prévu. Le calcul depuis un GPX uploadé (`src/lib/gpx.ts`) est lui indépendant de la source : distance par sommation haversine, D+/D- avec un seuil de bruit de 2m.

### Météo (OpenWeatherMap)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/brm/:brmEventId/meteo` | Météo actuelle + prévisions (jusqu'à 5 jours) pour la ville du BRM |

Nécessite `OPENWEATHER_API_KEY` (clé gratuite sur [openweathermap.org](https://openweathermap.org/api), endpoints `/data/2.5/weather` et `/data/2.5/forecast`). Sans elle, la route répond `503 not_configured` plutôt que d'empêcher le serveur de démarrer. Résultat caché 15 minutes par ville (`src/lib/openWeather.ts`) pour ne pas cogner l'API à chaque chargement de page. La ville interrogée est `BrmEvent.lieu` tel quel (pas de coordonnées stockées) — fonctionne bien pour une ville française reconnue par OpenWeatherMap, moins précis pour un lieu-dit.

**Cette clé est une variable d'environnement du serveur qui fait tourner le backend, pas un secret GitHub Actions** : un secret GitHub n'est injecté que dans les workflows CI, jamais automatiquement dans le process qui tourne en prod. Pose `OPENWEATHER_API_KEY` directement dans l'environnement d'exécution (fichier `.env` non committé en dev, variable d'environnement de l'hébergeur en prod). Un secret GitHub Actions n'aurait de sens ici que si un pipeline de déploiement existait et écrivait explicitement cette valeur sur le serveur au moment du déploiement — ce n'est pas encore le cas (voir "Pour la suite").

### Parcours PBP (carte, profil, météo le long du tracé)

Tracés multiples (officiel / provisoire / communautaire, + un tracé indicatif entre
villes de contrôle tant qu'aucun GPX n'est publié), simplification Douglas-Peucker 3D
côté serveur, projection des 16 contrôles 2027, simulation de passage par vague de
départ, météo à l'heure de passage estimée avec vent de face/dos. Routes `/api/pbp/*`.
**Voir [docs/PARCOURS-PBP.md](./docs/PARCOURS-PBP.md)**, notamment pour basculer sur
le GPX officiel le jour de sa publication (un simple import, sans redéploiement).

### Roadbook BRM (analyse GPX, allure, barrières horaires, suivi live)

Import GPX par glisser-déposer, contrôles détectés depuis les waypoints, heures de
passage à son allure, barrières horaires au barème ACP, suivi GPS ou manuel avec
avance/retard, export PDF et lien de suivi public. Routes `/api/roadbooks/*`, aucune
nouvelle variable d'environnement. **Voir [docs/ROADBOOK.md](./docs/ROADBOOK.md).**

### Actualités (agrégées depuis ACP et PBP)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/news` | Liste les actualités (filtres `?source=acp\|pbp` et `?q=recherche`), avec `lastUpdatedAt` |
| POST | `/api/news/refresh` | (admin) Déclenche un scraping immédiat des deux sites sources, sans attendre le prochain passage planifié |

Récupère chaque jour (`NEWS_SCRAPE_INTERVAL_HOURS`, 24h par défaut) les pages
`https://www.paris-brest-paris.org/actualites/` et
`https://www.audax-club-parisien.com/actualites/`, extrait titre/date/résumé/lien de
chaque article (`src/lib/newsScraper.ts`, via `cheerio`), et insère les nouveaux
(dédoublonnés par URL — contrainte unique en base, pas une vérification préalable
sujette à une course). Chaque nouvel article est aussitôt diffusé sur le chat/canal
Telegram configuré (`TELEGRAM_NEWS_CHAT_ID`) si le bot est configuré. Les deux sites
sources ont chacun leur propre gabarit HTML (WordPress/Astra pour l'ACP, un gabarit
maison pour PBP) : si l'un des deux change de mise en page, son scraping échoue
silencieusement (l'autre continue) plutôt que de planter le job périodique — à
surveiller si la page `/actualites` cesse de se mettre à jour pour une seule des
deux sources.

### Notifications personnalisées (changement de statut BRM)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/notifications` | (authentifié) Liste ses notifications (50 dernières) + nombre non lues |
| POST | `/api/notifications/:id/read` | Marque une notification comme lue |
| POST | `/api/notifications/read-all` | Marque toutes les notifications comme lues |

Déclenchées quand l'utilisateur choisit un BRM du calendrier ou change son statut
(`PUT`/`DELETE` sur `/api/brm/catalog/:id/participation`, voir `src/lib/notify.ts`) :
toujours créées en base (cloche de l'app), et envoyées en plus sur Telegram si le
compte y est lié. Distinct des webhooks (`brm.participation_changed`) qui diffusent
au groupe entier — ici, un message adressé uniquement à l'utilisateur concerné.

### Liaison de compte Telegram

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/profile/telegram` | Statut de la liaison (`linked`, `configured`, `botUsername` pour le lien direct) |
| POST | `/api/profile/telegram/link-code` | Génère un code à usage unique (15 min), à envoyer au bot via `/start <code>` |
| DELETE | `/api/profile/telegram` | Délie le compte |

Le bot tourne en long-polling (`src/lib/telegramBot.ts`, démarré au lancement du
serveur si `TELEGRAM_BOT_TOKEN` est configuré) plutôt qu'en webhook public : pas de
route à exposer ni d'appel `setWebhook` à faire soi-même, adapté à un service
auto-hébergé sur une IP résidentielle/NAS.

## Tests

```bash
npm test
```

Hachage de mot de passe, cycle de vie et isolation des BRM entre utilisateurs, calendrier
ACP (mock réseau), messagerie WebSocket (diffusion temps réel, auth au handshake,
persistance), webhooks (diffusion de groupe filtrée par événement, isolation par
propriétaire, signature HMAC), parcours (récupération automatique mockée,
upload/téléchargement GPX, isolation), météo (conversions d'unités, cache par ville,
503 propre sans clé configurée), profil (événements personnels isolés par utilisateur),
actualités (scraping des deux sites sources à partir de fixtures HTML réelles,
dédoublonnage par URL, diffusion Telegram, isolation admin de `/news/refresh`),
liaison Telegram (génération/consommation de code, isolation par utilisateur),
notifications personnalisées (créées sur changement de statut BRM).

### Guide de test rapide — actualités, Telegram, notifications

**Scraping des actualités** (sans toucher à Telegram) :

```bash
# En tant qu'administrateur (isAdmin=true en base) :
curl -X POST http://localhost:3001/api/news/refresh -b cookies.txt
# → {"added": N, "checked": M} — N nouveaux articles insérés sur M trouvés sur les
# deux sites. Recharger la page "Actualités" doit maintenant les afficher.
```

Si `added` reste à 0 à chaque appel alors que les sites ont publié du nouveau : vérifier
que les sélecteurs CSS dans `src/lib/newsScraper.ts` (`article.ast-article-post` pour
l'ACP, `article.tease-post` pour PBP) correspondent toujours à la mise en page actuelle
des deux sites — un changement de thème côté source est la cause la plus probable.

**Bot Telegram** :

1. Créer un bot via [@BotFather](https://t.me/BotFather) sur Telegram (`/newbot`),
   récupérer le token et le nom d'utilisateur.
2. Poser `TELEGRAM_BOT_TOKEN` (et `TELEGRAM_BOT_USERNAME` pour le lien direct) dans
   l'environnement du serveur, puis le redémarrer.
3. Pour la diffusion des actualités : ajouter le bot à un groupe/canal Telegram, lui
   donner les droits de poster, puis récupérer l'identifiant du chat — le plus simple
   est d'envoyer un message dans ce groupe puis d'appeler
   `https://api.telegram.org/bot<TOKEN>/getUpdates` et de lire `message.chat.id`
   (négatif pour un groupe/canal). Poser ce nombre dans `TELEGRAM_NEWS_CHAT_ID`.
4. Pour les notifications personnalisées : se connecter sur le site, ouvrir
   "Mon profil" → section "Telegram" → "Lier mon compte Telegram", puis suivre le
   lien (ou envoyer `/start <code>` au bot manuellement). La page se met à jour
   automatiquement une fois la liaison faite.
5. Choisir un BRM dans le calendrier (ou changer son statut) : un message
   personnalisé doit arriver en privé sur Telegram dans les secondes qui suivent, et
   la cloche de notification de l'app doit aussi se mettre à jour.

**Sans token configuré**, tout le reste de l'app continue de fonctionner normalement :
le scraping tourne et alimente quand même la page "Actualités" (juste sans diffusion
Telegram), la section "Telegram" de "Mon profil" affiche un message explicite, et les
notifications restent visibles dans la cloche de l'app.

## Frontend

Le dossier `web/` contient l'app React (Vite) branchée sur ce service : connexion,
tableau de bord (compte à rebours + suivi BRM), calendrier des BRM officiels,
messagerie temps réel, webhooks, parcours (upload GPX, météo live + prévisions,
notes) et profil (licence, carnet de bord, événements personnels).
Voir `web/README.md` pour le détail (notamment le découpage front/back qui évite le
CORS en gardant tout sous le même domaine en prod).

## Déploiement

Un seul conteneur Docker sert le frontend et le backend ensemble (voir `Dockerfile`,
`docker-compose.yml`). Déployé sur un Synology personnel : `scripts/auto-deploy.sh`,
planifié toutes les 5 min sur le NAS, récupère les derniers commits et reconstruit
l'image si besoin — pas de FTP ni d'hébergement mutualisé dans cette chaîne, qui ne
peuvent pas faire tourner un process Node en continu ni relayer le WebSocket du chat.
Voir **[DEPLOY.md](./DEPLOY.md)** pour la mise en place complète (DNS, reverse proxy
DSM, déploiement automatique).

## Pour la suite

- Passer `DATABASE_URL` sur Postgres en production (le schéma Prisma est compatible sans changement de code) — pour `Parcours.fileData` (BLOB), vérifier la limite de taille de ligne du moteur choisi si les GPX uploadés sont volumineux.
- Ajouter l'envoi d'email réel (vérification d'adresse, réinitialisation de mot de passe) — non implémenté ici.
- Pseudo configurable (actuellement, le nom affiché aux autres utilisateurs est la partie avant le `@` de l'email).
- Les webhooks n'ont ni file de retry ni historique des livraisons (un seul essai, timeout 5s, dernier statut seulement) — correct pour un petit groupe, à muscler (délais exponentiels, DLQ) si le volume grossit.
- Météo par nom de ville plutôt que par coordonnées précises du parcours — à affiner si `BrmEvent.lieu` ne correspond pas toujours à une ville reconnue par OpenWeatherMap.
- Récupération automatique du parcours limitée à OpenRunner pour l'instant ; Komoot/Garmin Connect/Strava nécessiteraient chacun leur propre adaptateur (et souvent une vraie API avec clé, contrairement à OpenRunner).
- Scraping des actualités basé sur des sélecteurs CSS propres à la mise en page actuelle de chaque site source — à surveiller en cas de refonte de l'un des deux (voir le guide de test plus haut).
- Notifications personnalisées limitées à Telegram + in-app pour l'instant ; un canal email suivrait le même schéma que `sendPasswordResetEmail` (`src/lib/mailer.ts`) si besoin.
