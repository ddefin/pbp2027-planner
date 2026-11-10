# Déploiement sur un Synology (NAS personnel)

Architecture : un seul conteneur Docker sert le frontend (fichiers statiques) et le
backend (API + WebSocket) sur le même port — cohérent avec le reste de l'app, qui
suppose une seule origine (voir `web/README.md`). Pas de FTP ni d'hébergement
mutualisé dans cette chaîne : le mutualisé OVH ne peut pas faire tourner un process
Node en continu ni relayer du WebSocket, donc il reste entièrement en dehors de ce
déploiement (le widget météo existant sur `lameteoducyclo.fr` n'est pas touché).

```
Internet → DNS (pbp2027.lameteoducyclo.fr) → ton IP/DDNS → reverse proxy DSM (HTTPS)
         → conteneur Docker sur le NAS (port 3202, écoute en local uniquement)
```

## 1. DNS (chez OVH)

Dans la zone DNS du domaine (Espace client OVH → Web Cloud → Noms de domaine →
`lameteoducyclo.fr` → Zone DNS — **pas** dans l'hébergement mutualisé, ce sont deux
écrans différents) :

- Si tu as une IP fixe : une entrée **A** `pbp2027` → ton IP publique.
- Si ton IP change (la plupart des connexions grand public) : utilise le DDNS
  Synology (Panneau de configuration → QuickConnect → DDNS, gratuit, donne un nom du
  type `tonnas.synology.me`), puis une entrée **CNAME** `pbp2027` → `tonnas.synology.me`.

## 2. Reverse proxy + HTTPS (DSM)

1. **Certificat** : Panneau de configuration → Sécurité → Certificat → Ajouter →
   Let's Encrypt, nom de domaine `pbp2027.lameteoducyclo.fr`. Nécessite que le port 80
   soit accessible depuis l'extérieur le temps de la validation (redirection de port
   sur ta box si ce n'est pas déjà fait pour un autre usage).
2. **Règle de reverse proxy** : Panneau de configuration → Portail de connexion →
   Avancé → Reverse Proxy → Créer.
   - Source : `pbp2027.lameteoducyclo.fr`, HTTPS, port 443, **coche "Activer HSTS" et
     "Prise en charge de WebSocket"** (indispensable pour le chat temps réel).
   - Destination : `localhost`, HTTP, port `3202` (le port **hôte** publié par
     `docker-compose.yml`, premier nombre de la ligne `ports:` — à garder identique
     des deux côtés si tu dois le changer un jour, lui était déjà pris sur ce NAS).

## 3. Runner GitHub Actions (sur le NAS, dans un conteneur)

Le déploiement se fait par un **runner auto-hébergé** : pas d'accès SSH exposé sur
Internet, pas de clé SSH à stocker comme secret GitHub. Le runner tourne *sur* le
NAS et c'est lui qui construit l'image Docker et redémarre le conteneur, en local.

**Le runner GitHub officiel ne s'installe pas directement sur DSM** : son
`config.sh` attend des outils que DSM n'a pas (`ldd` et d'autres bibliothèques),
même avec les paquets qui semblent nécessaires installés. La solution : le faire
tourner dans un conteneur Docker (`runner/`), avec le socket Docker du NAS monté
dedans pour qu'il puisse lancer `docker compose` sur l'hôte.

1. Dans GitHub : Settings du repo → Actions → Runners → **New self-hosted runner** →
   Linux x64. GitHub affiche un jeton d'enregistrement à usage unique (ne le partage
   avec personne, il expire en une heure environ) — **ignore les commandes `curl`/
   `config.sh` qu'il te montre**, ce sera fait par le conteneur à la place. Garde
   juste le jeton sous la main.
2. Connecte-toi en SSH au NAS, va dans le dossier `runner/` du repo cloné par ailleurs
   (ou clone juste ce dossier-là si besoin), et crée le fichier d'environnement :
   ```bash
   cd pbp2027-planner/runner
   cp .env.example .env
   nano .env   # colle le jeton de l'étape 1 dans RUNNER_TOKEN
   ```
3. **Ajoute `<utilisateur SSH>` au groupe `docker`** s'il n'y est pas déjà (Panneau de
   configuration → Groupe d'utilisateurs, ou `synogroup --member docker <utilisateur>`
   en SSH), puis reconnecte-toi — sinon le conteneur ne pourra pas parler au Docker du
   NAS malgré le socket monté.
4. Construit et démarre le conteneur :
   ```bash
   docker compose up -d --build
   ```
   Au tout premier démarrage, il s'enregistre auprès de GitHub avec le jeton fourni.
   Vérifie dans GitHub (Settings → Actions → Runners) qu'il apparaît **"Idle"** avec
   le label `synology` — le workflow cible `runs-on: [self-hosted, synology]`, donc ce
   label doit y être, sinon le job `deploy` reste bloqué "en attente".
5. Une fois enregistré, tu peux retirer `RUNNER_TOKEN` de `.env` (il a expiré de toute
   façon) : l'identité du runner est conservée dans le volume Docker nommé
   `runner-home` (pas un dossier visible dans `runner/` — `docker volume ls` le liste),
   qui survit aux redémarrages du conteneur. Ne le supprime pas (`docker volume rm`)
   sauf si tu veux vraiment ré-enregistrer le runner depuis zéro.

**Première vérification à faire à cette étape** (pas testable depuis l'environnement
qui a préparé ce repo, bloqué par la détection anti-bot de GitHub) : si
`docker compose up -d --build` échoue au téléchargement du runner avec une erreur
du style "404" ou une version vide, le `Dockerfile` n'a pas réussi à résoudre la
dernière version d'`actions/runner` — dis-le moi, je corrigerai la logique.

## 4. Première configuration (une fois, à la main sur le NAS)

```bash
# Dans le dossier où le runner a cloné le repo (généralement
# ~/actions-runner/_work/pbp2027-planner/pbp2027-planner) :
cp .env.production.example .env.production
nano .env.production   # renseigne MFA_ENCRYPTION_KEY (openssl rand -hex 32 —
                        # chiffre les secrets de webhook, nom historique),
                        # OPENWEATHER_API_KEY si tu l'utilises, etc.
mkdir -p data
```

Ce fichier n'est **jamais** commité ni poussé sur GitHub (il est dans
`.gitignore`) — c'est la bonne place pour ces valeurs, pas un secret GitHub
Actions, qui ne serait injecté que dans les workflows CI, jamais sur le
serveur qui tourne en continu.

Le `mkdir -p data` est nécessaire : `./data:/app/data` dans `docker-compose.yml`
est un *bind mount* (pas un volume Docker nommé), et Docker ne crée jamais le
dossier côté hôte lui-même — `docker compose up` échoue sinon avec `Bind mount
failed: '...' does not exist`. C'est une étape unique, à faire une seule fois.

Ce dossier `./data` contient la base SQLite — à inclure dans tes sauvegardes
NAS (Hyper Backup, par exemple), c'est la seule donnée qui ne se régénère pas
en redéployant.

### Mot de passe oublié (optionnel)

Sans configuration, "mot de passe oublié" répond juste "non disponible" — le
reste de l'app fonctionne normalement. Pour l'activer, renseigne dans
`.env.production` une boîte mail existante (ex. SMTP OVH) :

```
SMTP_HOST="ssl0.ovh.net"
SMTP_PORT=465
SMTP_USER="ton-adresse@tondomaine.fr"
SMTP_PASSWORD="le mot de passe de cette boîte mail"
```

(Les identifiants et le port exacts dépendent de ton hébergeur mail — pour OVH,
vérifie dans Espace client → Emails → le mode de connexion SMTP proposé.)

### Mode hors-ligne (PWA)

L'app peut être "installée" (Chrome/Android : bouton d'installation dans la barre
d'adresse ; iOS/Safari : "Partager" → "Sur l'écran d'accueil"). Une fois une carte
de BRM déjà consultée avec du réseau, ses tuiles restent affichables avec une
connexion coupée ou très mauvaise (utile en plein brevet) — rien à configurer côté
serveur, c'est un service worker généré au build (`web/dist/sw.js`).

### Alerte vent fort (optionnel, nécessite OPENWEATHER_API_KEY)

Si `OPENWEATHER_API_KEY` est renseignée, l'app vérifie automatiquement (toutes
les 6h) la météo prévue sur les BRM du calendrier ACP que quelqu'un a marqués
"prévu"/"inscrit" dans les 5 prochains jours. Si le vent (ou les rafales)
dépasse `WIND_ALERT_THRESHOLD_KMH` (50 km/h par défaut), l'événement webhook
"meteo.vent_fort" se déclenche — abonne un webhook Discord/Slack à cet
événement (page Webhooks) pour être notifié. Pas de notification en double :
au plus une par BRM et par jour de prévision.

### Sauvegardes automatiques

`./data` contient la base SQLite — c'est la seule donnée qui ne se régénère pas
en redéployant. `scripts/backup.sh` en fait une copie cohérente (via `VACUUM
INTO`, sans arrêter le conteneur) compressée dans `~/pbp2027-backups/`, et
purge celles de plus de 30 jours.

Pour l'automatiser sans crontab (DSM le déconseille), utilise le
**Planificateur de tâches** du Panneau de configuration :

1. Créer → Tâche déclenchée → Script défini par l'utilisateur.
2. Général : utilisateur `admin` (ou celui qui a accès à Docker), déclenchement
   quotidien à une heure creuse.
3. Paramètres de tâche → Exécuter la commande :
   ```bash
   /bin/sh ~/pbp2027-planner/scripts/backup.sh
   ```

Vérifie ensuite que `~/pbp2027-backups/` est bien inclus dans tes sauvegardes
NAS existantes (Hyper Backup), pour avoir une copie hors du NAS lui-même.

## 5. Déploiement

Le workflow `.github/workflows/deploy.yml` fait tourner les tests sur chaque push
(sur un runner GitHub classique) — ça, ça marche. Le job `deploy` qui suit, lui,
tourne sur le runner self-hébergé mais **ne doit pas être utilisé tel quel pour
déployer en production sur ce NAS** : ce runner a son propre clone du dépôt dans
son conteneur, et `docker compose up` lancé depuis là-dedans résout `./data`
(la base SQLite de prod) comme un chemin à l'intérieur de ce conteneur, pas le
vrai dossier de données du NAS — un déploiement qui irait jusqu'au bout
risquerait de faire tourner l'app sur un `./data` vide. Le job échoue
volontairement avant d'en arriver là (`.env.production manquant`, voir
Dépannage) ; ne crée pas ce fichier dans le clone du runner pour le "corriger".

**Déploiement automatique réel** : `scripts/auto-deploy.sh`, planifié toutes les
5 minutes via le Planificateur de tâches DSM — même principe que les sauvegardes
(étape précédente), tourne directement sur l'hôte donc sans l'ambiguïté
ci-dessus. Il vérifie les derniers commits sur `main` et reconstruit seulement
si besoin (peu coûteux à relancer souvent grâce au cache Docker).

1. Créer → Tâche déclenchée → Script défini par l'utilisateur.
2. Général : utilisateur **root** (évite les soucis de permissions Docker),
   déclenchement toutes les 5 minutes.
3. Paramètres de tâche → Exécuter la commande :
   ```bash
   /bin/sh ~/pbp2027-planner/scripts/auto-deploy.sh
   ```

Pour forcer un déploiement manuel immédiat (sans attendre le prochain passage) :

```bash
cd ~/pbp2027-planner
sudo docker run --rm -v "$(pwd):/repo" -w /repo alpine/git pull origin main
sudo docker compose up -d --build
```

## Dépannage

- **Le job `deploy` reste "en attente" sur GitHub** : le runner n'est pas démarré, ou
  le label `synology` ne correspond pas — vérifie Settings → Actions → Runners (doit
  afficher "Idle", pas "Offline").
- **`docker compose` échoue avec une erreur de permissions** : l'utilisateur du runner
  n'est pas dans le groupe `docker` (étape 3.5 ci-dessus).
- **Le chat ne se connecte pas (WebSocket)** : vérifie que "Prise en charge de
  WebSocket" est bien cochée dans la règle de reverse proxy DSM.
- **`.env.production manquant` dans le job `deploy`** : normal et volontaire (voir
  étape 5) — ce job n'est pas le mécanisme de déploiement réel sur ce NAS,
  `scripts/auto-deploy.sh` planifié s'en charge. Ne crée **pas** `.env.production`
  dans le clone du runner pour faire taire cette erreur : le job irait alors
  jusqu'au bout et risquerait de faire tourner l'app sur un dossier `./data` vide
  (voir l'explication à l'étape 5).
- **`scripts/auto-deploy.sh` ne semble pas tourner** : vérifie dans le
  Planificateur de tâches DSM que la tâche est bien activée et qu'elle a un
  historique d'exécution récent ; `sudo docker image prune -f` dans le script
  nécessite les droits root ou docker, d'où la recommandation de la lancer en
  tant que root (étape 5).
- **Rien ne change en production après un push sur `main`** : vérifie l'onglet
  Actions du dépôt GitHub — le job `test` doit être vert (c'est lui qui compte,
  le job `deploy` qui le suit échoue par conception, voir ci-dessus). `main` peut
  très bien être à jour sur GitHub sans que rien n'ait changé sur le NAS tant que
  `scripts/auto-deploy.sh` n'est pas passé (jusqu'à 5 min après le push) — ou
  lance le déploiement manuel de l'étape 5 pour ne pas attendre.
- **`Bind mount failed: '.../data' does not exist`** : le dossier `data` n'a pas été
  créé côté hôte avant le premier `docker compose up` — `mkdir -p data` dans le
  dossier du repo (étape 4), puis relance.
