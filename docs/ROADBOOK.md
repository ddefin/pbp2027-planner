# Roadbook BRM — guide d'intégration

Pages `/roadbooks` (liste + import), `/roadbooks/:id` (tableau de bord personnel) et
`/r/:jeton` (lien de suivi public, sans compte).

## Déploiement

**Aucune nouvelle variable d'environnement.** La migration Prisma
`add_roadbook` (deux tables : `Roadbook`, `RoadbookCheckin`) s'applique toute seule
au démarrage du conteneur (`prisma migrate deploy` dans la commande de démarrage).
Les GPX importés sont stockés dans `./data/uploads/roadbooks/`, donc sur le même
volume que la base, et couverts par `scripts/backup.sh`.

Points d'attention côté hébergement :
- **HTTPS obligatoire pour le GPS** : les navigateurs n'autorisent la géolocalisation
  que sur une page sécurisée. C'est déjà le cas en production (reverse proxy DSM).
- **Taille d'import** : 25 Mo max côté application. Si un gros GPX échoue avec une
  erreur 413, c'est la limite du reverse proxy DSM qu'il faut relever.

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
4. **Jour J** : suivi GPS en direct (recalé sur le tracé) ou saisie manuelle du km,
   ou « Pointé » au contrôle. Deux voyants :
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

- **Calculs côté client, fonctions pures** (`web/src/lib/roadbook.ts`) : le serveur ne
  stocke que les réglages et les positions. Changer la vitesse recalcule tout
  instantanément, le statut fonctionne hors-ligne (le roadbook est mis en cache par
  le service worker), et le lien public calcule le même statut que le propriétaire.
  Ces fonctions sont testées par Vitest depuis la racine du dépôt.
- **Recalage GPS** (`snapToRoute`) : recherche d'abord autour du dernier km connu,
  puis en avant, puis partout. Sans ça, sur une boucle, l'arrivée serait prise pour
  le départ, et sur un aller-retour le retour pour l'aller.
- **Envoi des positions** : la première, puis toutes les 5 min et à chaque contrôle
  franchi (pas à chaque point GPS), pour ménager batterie et forfait. Historique
  borné à 500 positions par roadbook.
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
