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

## Tests

```bash
npm test
```

Hachage de mot de passe, cycle de vie et isolation des BRM entre utilisateurs, calendrier
ACP (mock réseau), messagerie WebSocket (diffusion temps réel, auth au handshake,
persistance), webhooks (diffusion de groupe filtrée par événement, isolation par
propriétaire, signature HMAC), parcours (récupération automatique mockée,
upload/téléchargement GPX, isolation), météo (conversions d'unités, cache par ville,
503 propre sans clé configurée), profil (événements personnels isolés par utilisateur).

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
