# Espace d'administration (/admin)

Réservé aux comptes administrateurs (`User.isAdmin`). Pour nommer le premier administrateur, sur le NAS, dans le dossier du dépôt :

```
sudo sh scripts/make-admin.sh ton@email.fr
```

(`--retirer` en second argument retire le rôle.) Déconnecte-toi puis reconnecte-toi sur le site.

Ensuite, les rôles se gèrent depuis Administration → Utilisateurs.

## Pages

| Page | Contenu |
|---|---|
| Vue d'ensemble | 4 indicateurs (membres actifs, inscriptions, activité, incidents de compte) avec variation vs la période précédente ; activité par jour/mois (7 j, 30 j, 12 mois) ; dernières inscriptions et actions |
| Utilisateurs | recherche (prénom, e-mail, club), filtres statut/rôle, tri, pagination côté serveur, sélection multiple ; fiche d'un compte (état, données, appareils, connexions et mots de passe, historique) |
| Contenus | modération des messages du groupe, des tracés PBP et des traces GPX des BRM (les roadbooks sont privés et non modérables) |
| Journaux d'audit | actions d'administration (lecture seule) ; connexions et mots de passe, y compris pour une adresse sans compte |
| Paramètres | état de la configuration (mail, sauvegardes, Telegram, Strava, météo, sécurité), sans aucun secret |

Raccourcis : Ctrl/⌘+K (recherche de pages, comptes, tracés), sélecteur de thème clair/sombre/système dans la barre du haut.

## Sécurité

- **Contrôle d'accès** : une garde unique (`src/lib/adminGuard.ts`) sur tout le préfixe `/api/admin` (session valide, rôle ADMIN) + une vérification dans chaque route. `test/adminSecurity.test.ts` parcourt automatiquement toutes les routes admin déclarées et exige 401 en anonyme et 403 pour un membre.
- **CSRF** : cookie de session `SameSite=Strict` + vérification de `Origin` / `Sec-Fetch-Site` sur toute modification.
- **Débit** : 30 modifications/min par administrateur ; suppressions de comptes 5 / 10 min, de contenus 30 / 10 min ; 5 mots de passe erronés / 15 min bloquent les actions sensibles.
- **Ré-authentification** : mot de passe de l'administrateur pour changer un rôle ou supprimer un compte (+ saisie de l'adresse du compte supprimé).
- **Garde-fous** : jamais d'action sur son propre compte ; il reste toujours au moins un administrateur actif.
- **Audit** (`AdminAuditLog`) : écrit dans la même transaction que l'action (pas d'action sans trace), secrets masqués, aucune route de modification ou de suppression. Les événements de compte (`AuthEvent`) sont gardés 60 jours.
- **Validation** : schémas Zod partagés entre serveur et interface (`src/shared/adminSchemas.ts`), listes fermées pour le tri et les filtres.

## Suspension et suppression

- **Suspendre** : connexion refusée (après vérification du mot de passe, pour ne rien révéler), sessions coupées, compte retiré de la messagerie et des notifications. Réversible.
- **Supprimer** : anonymisation. Messages du groupe, conversations privées, tracés PBP, traces et points de contrôle des BRM passent au compte système « Membre supprimé » (aucune connexion possible) ; profil, licence, roadbooks, BRM personnels, Strava (accès révoqué chez Strava), sessions et fichiers personnels sont effacés.
