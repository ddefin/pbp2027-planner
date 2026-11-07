# PBP 2027 Planner — backend

Service d'authentification, de suivi BRM et de coordination des sorties pour le planner
de qualification Paris-Brest-Paris 2027.
Dépôt séparé de `lameteoducyclo.fr` (repo `meteo-velo`) — aucun impact sur le site météo existant.

## Choix de sécurité

- **Mots de passe** : `scrypt` (node:crypto, pas de dépendance tierce), sel aléatoire par utilisateur, comparaison en temps constant.
- **Sessions** : cookie `httpOnly`, `SameSite=Strict`, jeton opaque de 256 bits ; seul le hash SHA-256 du jeton est stocké en base (une fuite de la base ne permet pas de rejouer une session). Expiration glissante sur 30 jours.
- **MFA (TOTP, RFC 6238)** : implémentation maison sur `node:crypto` (HMAC-SHA1), secret de 160 bits, fenêtre de tolérance d'une étape de 30s pour la dérive d'horloge. Secret chiffré au repos (AES-256-GCM) avec `MFA_ENCRYPTION_KEY`.
- **Codes de récupération** : 10 codes à usage unique générés à l'activation de la MFA, hachés comme un mot de passe, affichés une seule fois.
- **Verrouillage de compte** : après 8 échecs de mot de passe, compte verrouillé 15 minutes.
- **Rate limiting** : 10 tentatives de login / 15 min par IP, 5 tentatives de code MFA / 5 min par challenge (en mémoire ; à migrer vers un backend partagé type Redis en cas de plusieurs instances).
- **Énumération de comptes** : `/api/auth/register` et les échecs de `/api/auth/login` renvoient des réponses génériques.
- **Toutes les routes sont sous `/api`** : évite toute collision avec les routes côté client du frontend (ex. `/sorties` existe à la fois côté API et côté React Router — sans préfixe, un rechargement de page sur cette URL serait intercepté par le proxy et renverrait la réponse JSON au lieu de l'app).

## Démarrer en local

```bash
cp .env.example .env
# openssl rand -hex 32  → colle le résultat dans MFA_ENCRYPTION_KEY
npm install
npm run prisma:migrate
npm run dev
```

Le service écoute sur `http://localhost:3001`.

## Endpoints

### Auth / MFA

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Création de compte (email + mot de passe) |
| POST | `/api/auth/login` | Étape 1 : vérifie le mot de passe. Renvoie soit une session, soit un `challengeToken` si la MFA est activée |
| POST | `/api/auth/mfa/verify` | Étape 2 : vérifie le code TOTP (ou un code de récupération) avec le `challengeToken`, ouvre la session |
| POST | `/api/auth/mfa/setup` | (authentifié) Génère un secret TOTP en attente + URI `otpauth://` pour le QR code |
| POST | `/api/auth/mfa/enable` | (authentifié) Confirme le secret en attente avec un premier code, active la MFA, renvoie les codes de récupération |
| POST | `/api/auth/mfa/disable` | (authentifié) Désactive la MFA |
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

### Sorties et chat

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/sorties` | Liste les sorties planifiées |
| POST | `/api/sorties` | Planifie une sortie (l'auteur y est automatiquement inscrit) |
| POST | `/api/sorties/:id/join` | Rejoint une sortie |
| DELETE | `/api/sorties/:id/join` | Se retire d'une sortie |
| GET | `/api/sorties/:id/messages` | Historique du chat de la sortie |
| WS | `/api/sorties/:id/chat` | Chat temps réel (diffusion à tous les participants connectés, persisté en base) |

### Webhooks

Notifications de groupe (Discord, Slack, ou un point de terminaison à soi en JSON signé HMAC-SHA256) déclenchées sur `sortie.created`, `sortie.participant_joined` et `brm.participation_changed`. Un abonnement est diffusé pour tout le monde dès qu'il écoute l'événement, pas seulement pour celui qui l'a configuré — c'est pensé pour un salon Discord/Slack partagé par le groupe, pas des notifications privées.

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
| PUT | `/api/brm/:brmEventId/parcours` | Enregistre `sourceUrl` (tente une récupération automatique immédiate), météo prévue et notes |
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

45 tests : hachage de mot de passe, TOTP (round-trip base32, tolérance de dérive d'horloge),
cycle de vie et isolation des BRM entre utilisateurs, calendrier ACP (mock réseau), sorties
et chat WebSocket (diffusion temps réel, auth au handshake, persistance), webhooks
(diffusion de groupe filtrée par événement, isolation par propriétaire, signature HMAC),
parcours (récupération automatique mockée, upload/téléchargement GPX, isolation), météo
(conversions d'unités, cache par ville, 503 propre sans clé configurée).

## Frontend

Le dossier `web/` contient l'app React (Vite) branchée sur ce service : connexion/MFA,
tableau de bord (compte à rebours + suivi BRM), calendrier des BRM officiels, sorties,
chat temps réel, webhooks et parcours (upload GPX, météo live + prévisions, notes).
Voir `web/README.md` pour le détail (notamment le découpage front/back qui évite le
CORS en gardant tout sous le même domaine en prod).

## Pour la suite

- Passer `DATABASE_URL` sur Postgres en production (le schéma Prisma est compatible sans changement de code) — pour `Parcours.fileData` (BLOB), vérifier la limite de taille de ligne du moteur choisi si les GPX uploadés sont volumineux.
- Ajouter l'envoi d'email réel (vérification d'adresse, réinitialisation de mot de passe) — non implémenté ici.
- Pseudo configurable (actuellement, le nom affiché aux autres utilisateurs est la partie avant le `@` de l'email).
- Déploiement réel (hébergement, domaine, reverse proxy, et donc un vrai usage pour un secret GitHub Actions) — non fait, voir `web/README.md` pour l'architecture prévue.
- Les webhooks n'ont ni file de retry ni historique des livraisons (un seul essai, timeout 5s, dernier statut seulement) — correct pour un petit groupe, à muscler (délais exponentiels, DLQ) si le volume grossit.
- Météo par nom de ville plutôt que par coordonnées précises du parcours — à affiner si `BrmEvent.lieu` ne correspond pas toujours à une ville reconnue par OpenWeatherMap.
- Récupération automatique du parcours limitée à OpenRunner pour l'instant ; Komoot/Garmin Connect/Strava nécessiteraient chacun leur propre adaptateur (et souvent une vraie API avec clé, contrairement à OpenRunner).
- Pas de prévision météo automatique (aucune API branchée) : les champs météo sont à remplir à la main à l'approche de la date.
