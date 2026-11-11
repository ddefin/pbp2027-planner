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

## 3. Runner GitHub Actions (optionnel, plus utilisé par défaut)

**Cette étape n'est plus nécessaire** : le déploiement se fait par
`scripts/auto-deploy.sh` (étape 5), planifié directement sur le NAS — pas besoin
d'un runner GitHub pour ça. Elle reste documentée ici seulement si tu veux un
jour faire tourner d'autres workflows sur ce NAS ; sinon ignore cette section et
passe à l'étape 4.

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

Le workflow `.github/workflows/tests.yml` fait tourner les tests sur chaque push,
sur un runner GitHub classique (`ubuntu-latest`) — c'est tout ce qu'il fait,
aucun déploiement dedans : un runner self-hébergé dans son propre conteneur
Docker ne peut pas déployer correctement sur ce NAS (`docker compose up` lancé
depuis là-dedans résoudrait `./data` — la base SQLite de prod — comme un chemin
à l'intérieur de ce conteneur, pas le vrai dossier de données du NAS : risque
réel de faire tourner l'app sur un `./data` vide).

**Le runner self-hébergé de l'étape 3 n'est donc plus utilisé par rien** (les
tests tournent sur l'infrastructure GitHub, le déploiement via
`scripts/auto-deploy.sh`) — tu peux l'arrêter sans rien casser si tu veux
libérer les ressources qu'il occupe sur le NAS :
```bash
cd ~/pbp2027-planner/runner
docker compose down
```

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

### Une mise à jour n'apparaît pas sur le site

1. **Quelle version tourne ?** En bas de « Mon profil » (ou sur `/health`) : `Version
   déployée : <commit> <date>`. Comparer avec le dernier commit sur GitHub.
2. **Que dit le déploiement automatique ?** Chaque passage de `scripts/auto-deploy.sh`
   est journalisé :
   ```bash
   cd /volume1/homes/admin/pbp2027-planner
   tail -n 30 deploy.log
   ```
   - `ÉCHEC git pull … would be overwritten by merge` : un fichier suivi par git a été
     modifié directement sur le NAS. Le voir puis l'annuler :
     ```bash
     sudo docker run --rm -v "$(pwd):/repo" -w /repo alpine/git -c safe.directory=/repo status --short
     sudo docker run --rm -v "$(pwd):/repo" -w /repo alpine/git -c safe.directory=/repo checkout -- <fichier>
     ```
     (Les réglages vont dans `.env.production`, jamais dans `.env.example` ni dans un
     autre fichier du dépôt.)
   - `ÉCHEC build/démarrage` : l'erreur de build suit dans le journal ; l'ancienne
     version continue de tourner en attendant.
3. **Forcer un déploiement tout de suite** : `sudo sh scripts/auto-deploy.sh`. Lancé dans
   un terminal, il affiche sa progression ; la reconstruction prend plusieurs minutes sur
   le NAS. Un seul déploiement à la fois : si la tâche planifiée est déjà en train de
   reconstruire, le script le dit et s'arrête (verrou `.deploy.lock`).


- **Le chat ne se connecte pas (WebSocket)** : vérifie que "Prise en charge de
  WebSocket" est bien cochée dans la règle de reverse proxy DSM.
- **`scripts/auto-deploy.sh` ne semble pas tourner** : vérifie dans le
  Planificateur de tâches DSM que la tâche est bien activée et qu'elle a un
  historique d'exécution récent ; `sudo docker image prune -f` dans le script
  nécessite les droits root ou docker, d'où la recommandation de la lancer en
  tant que root (étape 5).
- **Rien ne change en production après un push sur `main`** : vérifie l'onglet
  Actions du dépôt GitHub — le workflow `Tests` doit être vert. `main` peut très
  bien être à jour sur GitHub sans que rien n'ait changé sur le NAS tant que
  `scripts/auto-deploy.sh` n'est pas passé (jusqu'à 5 min après le push) — ou
  lance le déploiement manuel de l'étape 5 pour ne pas attendre.
- **`Bind mount failed: '.../data' does not exist`** : le dossier `data` n'a pas été
  créé côté hôte avant le premier `docker compose up` — `mkdir -p data` dans le
  dossier du repo (étape 4), puis relance.

### Alerte « sauvegarde manquante »

`scripts/backup.sh` écrit un témoin (`/app/data/.last-backup`) à chaque sauvegarde réussie.
L'application le relit chaque jour : sans sauvegarde depuis `BACKUP_MAX_AGE_DAYS` jours (3 par
défaut) — ou jamais —, les administrateurs reçoivent une notification dans l'app et sur le
canal Telegram des actualités (rappel tous les 3 jours). La date de la dernière sauvegarde
est aussi visible dans `/health` (`lastBackupAt`).
