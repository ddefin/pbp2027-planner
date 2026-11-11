# Parcours PBP — guide d'intégration

Page `/parcours-pbp` : carte du parcours, profil altimétrique, contrôles, simulation
de passage et météo le long du tracé.

## Le jour où l'organisation publie le GPX officiel

Rien à coder, rien à redéployer :

1. Se connecter avec un compte **administrateur**.
2. Page **Parcours PBP** → section **Tracés** (en bas) → « Importer un tracé GPX ».
3. Nom : par ex. `PBP 2027 — parcours officiel`, statut : **Officiel**, choisir le fichier, **Importer**.

C'est tout. Le tracé affiché par défaut est toujours le plus récent du statut le plus
élevé (**Officiel > Provisoire > Communautaire > Indicatif**) : dès l'import, tout le
monde bascule dessus au prochain chargement de la page. Les autres tracés ne sont pas
supprimés — ils restent sélectionnables et superposables (« comparer »).

Si l'organisation publie une **mise à jour** du GPX officiel : importer le nouveau
fichier en « Officiel » (il devient le défaut car plus récent), puis repasser
l'ancien en « Provisoire » ou le supprimer depuis la même liste.

Un tracé importé par erreur en « Officiel » : changer son statut dans la liste
(menu déroulant visible des admins) ou le supprimer.

### Ce qui est recalculé automatiquement à l'import

- **Simplification** Douglas-Peucker 3D (géométrie + altitude) jusqu'à ≤ 4000 points :
  un GPX de 50 000 points devient ~3 000 points (~90 Ko transférés) sans perdre les
  virages ni les bosses. Distance et D+/D- sont calculés **avant** simplification,
  sur le tracé complet.
- **Contrôles** : les 16 villes de contrôle 2027 sont projetées sur le tracé, dans
  l'ordre du parcours (Tinténiac, Fougères, Villaines et Mortagne sont visitées à
  l'aller et au retour : c'est le premier passage *après le contrôle précédent* qui
  est retenu). Le tableau donne le km exact, la distance et le D+ de chaque étape.
- **Waypoints** (`<wpt>`) du GPX : affichés tels quels (calque « Points du GPX »),
  avec leur km. Si le GPX officiel contient les emplacements exacts des contrôles,
  ils apparaîtront là.
- **Météo** : échantillonnée à chaque contrôle + tous les 60 km.

Le GPX d'origine est conservé (bouton « GPX » de la liste) : si l'algorithme de
simplification évolue, on peut retraiter les fichiers sans les redemander.

## Si l'organisation change la liste des contrôles ou les vagues de départ

Un seul fichier : `src/lib/pbpControls.ts`.

- `PBP_2027_CONTROLS` : ordre, nom, coordonnées (centre-ville tant que l'emplacement
  exact n'est pas connu), `officialKm` quand l'organisation publie le kilométrage,
  services (🚨 🍴 🚿 🛏️ ⚙️), note éventuelle.
- `PBP_2027_WAVES` : heures de départ (heure de Paris) et délais (80/84/90 h).
- `PBP_2027_TOTAL_KM`.

Les `officialKm` servent aussi à recaler le kilométrage du **tracé indicatif** (lignes
droites entre contrôles, affiché tant qu'aucun GPX n'est importé) : plus il y a de
distances officielles renseignées, plus ce tracé indicatif est juste.

## Configuration (clés d'API)

| Service | Clé | Où |
|---|---|---|
| Météo (OpenWeatherMap) | `OPENWEATHER_API_KEY` (déjà utilisée par le reste de l'app) | `.env.production`, côté serveur uniquement |
| Fonds de carte IGN (Plan, Photo) | aucune — Géoplateforme publique | — |
| CyclOSM, OpenTopoMap, Esri Satellite | aucune | — |

La clé météo ne quitte jamais le serveur : le navigateur appelle
`/api/pbp/routes/:id/weather`, le serveur interroge OpenWeatherMap et met le résultat
en cache 30 min par zone de ~5 km (tous les utilisateurs partagent les mêmes appels).
Coût : ~35 appels pour un calcul complet du parcours, très en dessous du quota
gratuit (60/min, 1 million/mois).

Sans `OPENWEATHER_API_KEY`, la page fonctionne entièrement sauf la section météo, qui
l'indique clairement.

### Horizon de prévision

L'API gratuite prévoit à **5 jours** (créneaux de 3 h). Avant J-5, la frise affiche
« hors horizon » au lieu d'inventer une météo ; le mode « Date libre » permet de
tester avec un départ cette semaine. Les vraies prévisions du PBP apparaissent
automatiquement à partir du 17-18 août 2027, sans rien changer.

## Hors-ligne (sur la route)

Le service worker garde en cache (stratégie « réseau d'abord ») le tracé, les
contrôles et la dernière météo calculée, ainsi que les tuiles de carte déjà
affichées (IGN compris). Conseil à donner aux participants : ouvrir la page et
zoomer sur les portions utiles une fois en wifi avant le départ.

## Architecture

| Fichier | Rôle |
|---|---|
| `src/lib/geo.ts` | Haversine, cap, Douglas-Peucker 3D itératif, interpolation au km |
| `src/lib/gpx.ts` → `parseGpxRoute` | Lecture GPX (trk/rte + wpt), distance/D+ sur tracé complet, simplification |
| `src/lib/pbpControls.ts` | Contrôles et vagues 2027, tracé indicatif, projection des contrôles |
| `src/lib/routeWeather.ts` | Échantillonnage, heure de passage, vent de face/dos, alertes |
| `src/lib/openWeather.ts` → `fetchForecastAt` | Prévisions par coordonnées, cache |
| `src/routes/pbpRoutes.ts` | API `/api/pbp/*` |
| `web/src/pages/PbpRoutePage.tsx` | Page (chargée à la demande) |
| `web/src/components/pbp/*` | Carte, frise météo, tableau des contrôles, gestion des tracés |
| `web/src/lib/mapLayers.ts` | Fonds de carte partagés (aussi utilisés par les cartes de BRM) |

### API

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/pbp/meta` | Contrôles, vagues de départ, météo configurée ou non |
| GET | `/api/pbp/routes` | Tracés disponibles (sans les points) + `defaultId` |
| GET | `/api/pbp/routes/:id` | Points (format compact `[lat, lon, ele, km]`), waypoints, contrôles projetés. `:id = indicatif` pour le tracé indicatif |
| POST | `/api/pbp/routes` | Import multipart (`label`, `kind`, `description`, puis `file`). `kind` officiel/provisoire réservé aux admins (sinon forcé à communautaire). 25 Mo max |
| PATCH | `/api/pbp/routes/:id` | (admin) libellé, statut, description |
| DELETE | `/api/pbp/routes/:id` | Auteur ou admin |
| GET | `/api/pbp/routes/:id/gpx` | GPX d'origine |
| GET | `/api/pbp/routes/:id/weather?start=ISO&speed=kmh&step=km` | Météo le long du tracé à l'heure de passage estimée |
| GET | `/api/pbp/weather/point?lat&lon` | Prochaines 24 h au point donné (bouton « Ma position ») |

### Alertes météo (seuils vélo, pas vigilance officielle)

`src/lib/routeWeather.ts` : vent fort (≥ `WIND_ALERT_THRESHOLD_KMH` ou rafales ≥ 65 km/h),
vent de face (composante contraire ≥ 20 km/h, calculée sur le cap local de la route
à ±3 km), pluie (probabilité ≥ 60 % ou ≥ 2 mm/3 h), froid (ressenti ≤ 5 °C),
chaleur (ressenti ≥ 30 °C).

## Suivi des participants

Pas de flux de positions public pour l'instant : la page propose la position
**estimée** (curseur km + heure de départ + moyenne) et la position **réelle** de
l'utilisateur (bouton « Ma position », rapportée au km le plus proche du tracé). Si
l'organisation ouvre un flux de pointages aux contrôles pendant l'épreuve, il se
brancherait sur le calque des contrôles de `RouteMap` (marqueurs déjà indexés par
étape).
