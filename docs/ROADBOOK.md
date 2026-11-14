# Roadbook BRM — guide d'intégration

Pages `/roadbooks` (liste + import), `/roadbooks/:id` (tableau de bord personnel) et
`/r/:jeton` (lien de suivi public, sans compte).

## Déploiement

**Une seule variable, optionnelle : `TELEGRAM_TRACKING_CHAT_ID`** (canal où publier les
résumés de situation, voir plus bas). La migration Prisma
`add_roadbook` (deux tables : `Roadbook`, `RoadbookCheckin`) s'applique toute seule
au démarrage du conteneur (`prisma migrate deploy` dans la commande de démarrage).
Les GPX importés sont stockés dans `./data/uploads/roadbooks/`, donc sur le même
volume que la base, et couverts par `scripts/backup.sh`.

Points d'attention côté hébergement :
- **HTTPS obligatoire pour le GPS** : les navigateurs n'autorisent la géolocalisation
  que sur une page sécurisée. C'est déjà le cas en production (reverse proxy DSM).
- **Taille d'import** : 25 Mo max côté application. Si un gros GPX échoue avec une
  erreur 413, c'est la limite du reverse proxy DSM qu'il faut relever.

## Organisation de la page

Quatre onglets, dans une barre collée en haut de l'écran (la page est pensée pour le
téléphone, au guidon) ; l'onglet actif est mémorisé dans l'adresse (`#partage`…), donc un
rechargement ou un lien direct rouvre le bon.

| Onglet | Contenu |
|---|---|
| 📍 **Suivi** | Lien Garmin LiveTrack, statut avance/retard et barrière horaire, **pointage**, **« Partager ma situation »** (WhatsApp, lien de suivi, état du canal Telegram), carte, profil altimétrique |
| 📋 **Roadbook** | Résumé, tableau des contrôles (pauses modifiables), points d'intérêt du GPX, **export PDF** |
| ⚙️ **Réglages** | Nom, type de brevet, départ, allure (vitesse, montées, pauses) ; téléchargement du GPX et suppression |
| 📣 **Partage** | Lien de suivi (créer, partager, renouveler, désactiver), WhatsApp, canal Telegram (publication, mode d'emploi, test admin), Garmin LiveTrack |

L'onglet d'ouverture dépend de la situation : **Réglages** tant que l'heure de départ n'est
pas renseignée, **Roadbook** pour préparer, **Suivi** à moins de 3 h du départ et pendant le
brevet. Les proches qui ouvrent le lien de suivi n'ont que **Suivi** et **Roadbook**, en
lecture seule.

Dans Réglages et Partage, chaque groupe de choix est une **section dépliable** dont le
résumé d'état reste visible fermée (« ✓ Lien actif », « ⚠ Dernière publication échouée »…).
Une section **s'ouvre d'elle-même quand quelque chose demande attention** (départ à
renseigner, lien pas encore créé, publication Telegram en échec) mais ne se referme jamais
toute seule ; le choix de la personne est mémorisé sur son appareil. Même principe pour les
filtres du calendrier et des actualités, repliés par défaut sur téléphone
(`web/src/components/Disclosure.tsx`).

Sur téléphone, le tableau des contrôles devient une fiche par contrôle (pas de défilement
latéral). À l'impression, seuls le profil et le roadbook sont imprimés, quel que soit
l'onglet actif.

## Parcours utilisateur

1. **Import** : glisser-déposer (ou sélection sur mobile) d'un `.gpx` (`<trk>` ou
   `<rte>`). Le serveur calcule distance, D+/D- sur le tracé complet, simplifie la
   géométrie (Douglas-Peucker 3D, ≤ 4000 points), puis :
   - devine le type de brevet : 200/300/400/600 si la distance est entre −3 % et
     +10 % de la distance nominale (un 200 de 215 km reste un 200 avec 13h30), sinon
     « sur-mesure » avec un délai à 15 km/h, modifiable ;
   - propose les contrôles : départ, les waypoints (`<wpt>`) dont le nom ressemble
     à un contrôle (« CP », « contrôle », « pointage », « tampon », « check »,
     « secret »…), et l'arrivée. Les autres waypoints deviennent des points
     d'intérêt, qu'on peut promouvoir en contrôle d'un clic. Les waypoints sont
     projetés dans l'ordre du fichier : sur un aller-retour, le contrôle du retour
     n'est pas rabattu sur l'aller.
2. **Allure** : type de brevet ou délai sur-mesure, heure de départ, vitesse roulée
   (hors arrêts), pénalité optionnelle de montée (min / 100 m D+), pause par
   contrôle (modifiable ligne par ligne, ou « même pause partout »). Tout est
   enregistré automatiquement.
3. **Roadbook** : heure d'arrivée prévue à chaque contrôle, fenêtre officielle
   d'ouverture/fermeture, marge, D+ par étape, résumé (arrivée, temps total, arrêts,
   moyenne générale, marge sur le délai).
4. **Jour J** : **pointage à la demande**. Le bouton « 📍 Pointer ma position » allume
   le GPS le temps d'un seul relevé, recale la position sur le tracé et l'enregistre.
   On peut aussi saisir le km à la main, ou appuyer sur « Pointé » au contrôle (sans
   GPS ni réseau consommé). Il n'y a **jamais de suivi en continu** ni d'écran maintenu
   allumé : la batterie n'est sollicitée que quelques secondes par pointage. Chaque
   pointage met à jour le statut et la page de suivi partagée. Si l'envoi échoue
   (pas de réseau), l'écran le dit clairement. Deux voyants :
   - **Mon objectif** : avance/retard sur son propre roadbook
     (vert ≥ 0, orange jusqu'à −30 min, rouge au-delà) ;
   - **Barrière horaire** : marge à l'arrivée au prochain contrôle *en roulant à sa
     vitesse habituelle, sans pause* (vert ≥ 45 min, orange 0–45 min, rouge si le
     contrôle fermera avant d'y arriver, « hors délai » s'il est déjà fermé). Comme
     dans le règlement BRM, seuls les contrôles ont une heure de fermeture : rouler
     sous les 15 km/h entre deux contrôles n'est pas éliminatoire en soi.
   Plus la vitesse minimale pour atteindre le prochain contrôle à temps et la
   moyenne minimale pour finir dans le délai.
5. **Export PDF** : bouton « Exporter en PDF » (impression du navigateur, puis
   « Enregistrer en PDF », qui marche aussi sur iPhone via Partager → Imprimer). La
   mise en page d'impression garde une page A4 : titre, réglages, profil, roadbook.
6. **Partage** : lien `/r/<jeton>` en lecture seule, rafraîchi chaque minute pour
   suivre la progression. Jeton aléatoire de 128 bits. « Nouveau lien » révoque
   l'ancien, « Désactiver » coupe tout accès. Le lien n'expose ni email ni
   identifiant de compte, seulement le prénom, le tracé, les horaires et les
   positions déclarées.

## Suivi par les proches : Telegram et Garmin LiveTrack

### Pointer depuis Telegram

Une fois son compte lié (« Mon profil » → Telegram), le randonneur écrit **en privé**
au bot :

| Message | Effet |
|---|---|
| 📎 → Position → « Envoyer ma position actuelle » | Pointage GPS (un seul relevé, recalé sur le tracé ; refusé à plus de 10 km du tracé) |
| `/km 125` | Je suis au km 125 |
| `/cp` puis `/cp 2` | Liste des contrôles, puis pointé au contrôle n°2 |
| `/statut` | Ma situation, sans pointer ni publier |
| `/aide` | Mode d'emploi |

Le pointage s'applique au roadbook **en cours** : départ passé et délai (+ 6 h) pas
écoulé, sinon le prochain à partir, sinon le dernier modifié. La position « en
direct » de Telegram est volontairement ignorée après son premier point : pas de
suivi continu, un pointage = un message. Les messages venant d'un groupe ou d'un
canal sont ignorés.

### Résumé de situation publié sur le canal

À chaque pointage (depuis Telegram **ou** depuis le site), si le randonneur ne l'a pas
désactivé (case « Publier un résumé… » du roadbook, cochée par défaut), le bot publie
sur `TELEGRAM_TRACKING_CHAT_ID` :

- km parcourus / total, km restants, commune la plus proche (géocodage inverse
  OpenWeatherMap) ;
- temps écoulé depuis le départ, heure du pointage ;
- délais du BRM : marge sur le prochain contrôle (heure de fermeture comprise),
  verte/orange/rouge, et avance/retard sur son propre roadbook ;
- moyenne pauses comprises, et estimation hors pauses (pauses prévues aux contrôles
  déjà passés déduites) ;
- arrivée estimée à l'allure prévue (montées et pauses restantes comprises), au
  rythme moyen actuel, et marge sur le délai officiel ;
- D+ restant, moyenne minimale pour finir, distance et heure estimée du prochain
  contrôle ;
- météo maintenant, au prochain contrôle et à l'arrivée **aux heures estimées de
  passage** : température et ressenti, vent (rafales, de face/dos/travers selon le
  sens de la route), pluie, alertes ;
- liens Garmin LiveTrack et page de suivi (si activés).

Le randonneur reçoit le même résumé en privé. Deux pointages à moins de 2 min
d'intervalle ne publient qu'un message. Une erreur de publication (canal mal
configuré, bot pas administrateur) n'empêche jamais le pointage.

**Mise en place du canal** : ajouter le bot comme **administrateur** du canal
(droit « Publier des messages »), puis renseigner son identifiant (nombre négatif
commençant par `-100`) dans `TELEGRAM_TRACKING_CHAT_ID`, et redémarrer le conteneur.
Sans cette variable, le canal des actualités (`TELEGRAM_NEWS_CHAT_ID`) sert de repli.
Pour que le lien vers la page de suivi figure dans le message, `PUBLIC_URL` doit être
renseignée.

**Si rien n'arrive sur le canal** : sur la page d'un roadbook, bouton
« 🔧 Tester la publication sur le canal » (admin). Il envoie un message de test et
affiche la réponse exacte de Telegram avec l'action à faire. Les causes courantes :
bot pas administrateur du canal, identifiant faux, variable absente de
`.env.production`, conteneur pas redémarré. Chaque roadbook affiche aussi le résultat
de sa dernière publication, et le bot dit au randonneur si son pointage n'a pas pu
être publié. Côté serveur : `sudo docker logs pbp2027-planner 2>&1 | grep telegram`.

### Garmin LiveTrack

Le randonneur colle dans son roadbook le lien LiveTrack de sa sortie (reçu par email
ou dans Garmin Connect). C'est le compteur qui suit la position, sans rien demander au
téléphone ni au serveur. Le lien apparaît en tête de la page de suivi des proches et
dans les résumés du canal. Seuls les liens Garmin (`livetrack.garmin.com`,
`share.garmin.com`, `connect.garmin.com`, `gar.mn`) sont acceptés, puisqu'ils sont
republiés au groupe. Garmin n'offrant pas d'API ouverte, ces positions n'alimentent
pas le calcul d'avance/retard : seuls les pointages le font.

## Calcul des barrières horaires

`web/src/lib/roadbook.ts` → `controlWindow()`, barème standard des calculateurs
ACP/RUSA :
- ouverture : 34 km/h jusqu'à 200 km, 32 jusqu'à 400, 30 jusqu'à 600, 28 jusqu'à 1000 ;
- fermeture : 15 km/h jusqu'à 600 km (11,428 jusqu'à 1000) ; pour les contrôles à
  60 km ou moins du départ, 20 km/h + 1 h ;
- contrôle d'arrivée (ou au-delà de la distance nominale) : délai officiel
  (13h30 / 20 h / 27 h / 40 h).

Vérifié dans `test/roadbookLib.test.ts` contre des valeurs de référence (ex. km 550
d'un 600 : ouverture 17h08, fermeture 36h40). **La carte de route remise par
l'organisateur fait foi** : l'interface le rappelle sous le tableau.

## Choix techniques

- **Calculs en fonctions pures, source unique** (`src/shared/roadbookCalc.ts`, sans
  aucun import) : utilisée par le serveur (résumés Telegram) et ré-exportée par le
  frontend (`web/src/lib/roadbook.ts`). Le build Docker du frontend copie ce dossier.
  Le serveur ne stocke que les réglages et les positions. Changer la vitesse recalcule tout
  instantanément, le statut fonctionne hors-ligne (le roadbook est mis en cache par
  le service worker), et le lien public calcule le même statut que le propriétaire.
  Ces fonctions sont testées par Vitest depuis la racine du dépôt.
- **Recalage GPS** (`snapToRoute`) : projection sur les segments du tracé (pas
  seulement ses sommets : une ligne droite simplifiée peut n'en avoir que deux sur
  plusieurs km), recherche d'abord autour du dernier km connu, puis en avant, puis
  partout. Sans ça, sur une boucle, l'arrivée serait prise pour
  le départ, et sur un aller-retour le retour pour l'aller.
- **Envoi des positions** : uniquement à chaque pointage volontaire, sans cadence
  automatique. Historique borné à 500 positions par roadbook.
- **Réutilisation** : carte (`components/pbp/RouteMap`, rendu canvas, fonds IGN,
  plein écran), profil (`ElevationProfile`), parsing GPX (`parseGpxRoute`) — communs
  avec la page Parcours PBP.
- **Mode plein soleil** : fond blanc, texte noir, traits épais, quel que soit le thème
  du téléphone (mémorisé par appareil).

## API

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/roadbooks` | Mes roadbooks (sans les points) |
| POST | `/api/roadbooks` | Import multipart (`file`) → analyse + contrôles proposés |
| GET | `/api/roadbooks/:id` | Roadbook complet (points compacts `[lat, lon, ele, km]`) + 200 dernières positions |
| PATCH | `/api/roadbooks/:id` | Titre, `classKm`, `limitMinutes`, `startAt`, `movingSpeedKmh`, `climbPenaltyMinPer100m`, `controls[]` |
| DELETE | `/api/roadbooks/:id` | Supprime roadbook, GPX et positions |
| GET | `/api/roadbooks/:id/gpx` | GPX d'origine |
| POST | `/api/roadbooks/:id/share` | `{enabled}` : (re)génère ou supprime le jeton |
| POST | `/api/roadbooks/:id/checkins` | `{km, lat?, lon?, source: gps\|manuel\|controle}` |
| DELETE | `/api/roadbooks/:id/checkins` | Remet le suivi à zéro |
| GET | `/api/roadbooks/shared/:token` | **Public**, lecture seule |

Toutes les routes sauf la dernière sont réservées au propriétaire : un roadbook
d'un autre utilisateur répond 404, sans même confirmer son existence.

## Pointage sans réseau

Hors réseau, « Pointer ma position » / « Je suis à ce km » / « Pointé ✔ » ne sont plus perdus : le pointage est gardé dans le téléphone (localStorage, `pbp.checkinQueue`) avec son **heure réelle** et un identifiant anti-doublon (`clientId`). Dès que le réseau revient (événement `online`, ou toutes les 30 s page ouverte), la file est renvoyée dans l'ordre ; seul le **dernier** pointage est publié sur le canal (les autres sont enregistrés avec `announce:false`). Un renvoi du même `clientId` est ignoré par le serveur (HTTP 200, `duplicate:true`). Un pointage reçu plus de 20 min après son heure réelle est annoncé « envoyé avec retard » et sans météo « maintenant ». La session est mémorisée pour que la page reste utilisable sans réseau (seule une vraie réponse 401 déconnecte).

## Alertes proactives sur le canal

Un passage toutes les 10 min (`src/lib/roadbookAlerts.ts`) pour les roadbooks avec départ renseigné et publication activée :

- **Silence** : aucun pointage depuis `ROADBOOK_SILENCE_HOURS` (3 h par défaut), une fois par dernier pointage.
- **Contrôle fermé sans pointage** : l'heure de fermeture du prochain contrôle est passée, une fois par contrôle.
- **Météo à venir** : pluie / vent fort / vent de face / froid / chaleur prévus au prochain contrôle ou à l'arrivée dans les 3 h (position de moins de 90 min), au plus toutes les 6 h par situation.
- **Barrière en danger** : au pointage, message à part si la marge au prochain contrôle est négative (une fois par contrôle).

Les alertes déjà envoyées sont mémorisées (`RoadbookAlert`) ; un envoi refusé par Telegram est retenté au passage suivant.

## Surveillance du parcours officiel

Toutes les heures (`src/lib/pbpRouteWatch.ts`), la page https://www.paris-brest-paris.org/parcours/ est lue. Tant que « Retrouvez bientôt tous les liens vers les fichiers GPX » y figure, le tracé n'est pas publié. Quand la mention disparaît ou que des liens GPX/cartes apparaissent : notification dans l'app à tous les admins + message sur le canal actualités, et bandeau sur la page Parcours PBP. La première lecture ne notifie jamais.

## Préparation et suivi des proches

Aucun suivi GPS continu (batterie) : tout part des pointages volontaires.

- **Check-list de départ** (Réglages) : liste type d'un brevet, cases à cocher, éléments ajoutables/supprimables, enregistrée dans le roadbook (`Roadbook.checklist`), jamais exposée sur le lien public.
- **Nutrition et ravitaillement** (onglet Roadbook) : par tronçon entre contrôles, eau et glucides d'après le temps de roulage (réglables : 500 ml/h, 60 g/h, réserve 1,5 L), points d'eau/ravito du GPX reconnus à leur nom, alerte si un tronçon dépasse la réserve sans point repéré.
- **Compteur GPS** (Réglages) : `GET /api/roadbooks/:id/export?format=gpx|tcx` — tracé + contrôles (heures d'ouverture/fermeture/prévue) + points d'eau/ravito. TCX « Course » pour Garmin Connect (noms ≤ 10 caractères).
- **Vue en direct pour les proches** : `GET /api/roadbooks/shared/:token/live` (sans session) — km, ville, arrivée prévue et au rythme actuel, marge de barrière, prochain contrôle, météo devant ; recalculée au plus toutes les 10 min par roadbook, page rafraîchie toutes les 5 min.
- **Sauvegarde** : voir DEPLOY.md (alerte si plus de sauvegarde depuis `BACKUP_MAX_AGE_DAYS` jours).

## Carte du groupe le jour J

Page « Carte du groupe » (`/carte-groupe`, membres connectés) : dernier pointage des randonneurs en brevet. Un roadbook n'y apparaît que si son auteur a coché « Carte du groupe » dans l'onglet Partage (`Roadbook.groupShare`, désactivé par défaut), et seulement de 12 h avant le départ à 6 h après le délai. Aucun suivi GPS continu : la position est celle du dernier pointage (ou du tracé au km pointé). Route : `GET /api/group/live`.

## Rappels avant un BRM

Pour chaque BRM « Prévu » ou « Inscrit » du calendrier : rappel à J-7 et la veille (avec la météo prévue au départ quand elle est disponible), dans la cloche et sur Telegram si le compte est lié. Une seule fois par échéance (`BrmReminder`), à partir de 7 h (heure de Paris). Code : `src/lib/brmReminders.ts`.
