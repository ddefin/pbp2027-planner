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

## Tests

```bash
npm test
```

27 tests : hachage de mot de passe, TOTP (round-trip base32, tolérance de dérive d'horloge),
cycle de vie et isolation des BRM entre utilisateurs, calendrier ACP (mock réseau), sorties
et chat WebSocket (diffusion temps réel, auth au handshake, persistance).

## Frontend

Le dossier `web/` contient l'app React (Vite) branchée sur ce service : connexion/MFA,
tableau de bord (compte à rebours + suivi BRM), calendrier des BRM officiels, sorties et
chat temps réel. Voir `web/README.md` pour le détail (notamment le découpage front/back
qui évite le CORS en gardant tout sous le même domaine en prod).

## Pour la suite

- Passer `DATABASE_URL` sur Postgres en production (le schéma Prisma est compatible sans changement de code).
- Ajouter l'envoi d'email réel (vérification d'adresse, réinitialisation de mot de passe) — non implémenté ici.
- Pseudo configurable (actuellement, le nom affiché aux autres utilisateurs est la partie avant le `@` de l'email).
- Déploiement réel (hébergement, domaine, reverse proxy) — non fait, voir `web/README.md` pour l'architecture prévue.
