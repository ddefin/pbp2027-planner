# Accessibilité (VoiceOver, clavier, malvoyants)

Objectif : un site utilisable avec un lecteur d'écran (VoiceOver sur iPhone et Mac), au clavier seul et avec une
vue réduite — référence WCAG 2.2 niveau AA. La console d'administration et la page Webhooks (réservées aux
administrateurs) ne sont pas dans le périmètre.

## Règles appliquées
- **Structure** : un titre H1 par page (lu au changement de page), régions `header` / `nav` / `main`, lien
  « Aller au contenu » en tête de page. À chaque navigation, le titre de l'onglet change et le focus va sur le titre
  de la nouvelle page : VoiceOver l'annonce.
- **Commandes** : uniquement de vrais boutons et liens ; toute action à la souris a un équivalent clavier (ex. lignes
  des tableaux de contrôles : bouton sur le kilomètre). Boutons en icône seule nommés ; emojis décoratifs des titres
  non lus.
- **Formulaires** : chaque champ a une étiquette ; erreurs annoncées (`role="alert"`), confirmations lues sans
  déplacer le focus (`role="status"`).
- **Graphiques et cartes** : le profil altimétrique est décrit en une phrase (distance, D+, point haut, montées) ;
  les marqueurs de carte portent un nom et les marqueurs décoratifs ne prennent pas le focus. Toute l'information des
  cartes existe aussi en texte (tableaux de contrôles, journal des pointages, listes).
- **Compte à rebours** : lu en une phrase (« 280 jours, 23 heures et 12 minutes avant le départ »), jamais seconde par
  seconde.
- **Couleurs** : contraste d'au moins 4,5:1 pour le texte (thème clair : accent `#cf3450`, vert `#23784a`, orange
  `#9a5a0a`), liens dans le texte soulignés, aucune information portée par la seule couleur (statuts et niveaux
  toujours écrits, coche sur les contrôles passés). Focus clavier toujours visible.

## Contrôle automatique
`scripts/a11y-audit.mjs` (axe-core) parcourt les pages principales en mobile, bureau et thème sombre, contre un
serveur local de test ; voir l'en-tête du script pour l'installation des outils. Il n'est pas dans la CI GitHub
(pas de navigateur) : à lancer après une modification visuelle importante.

## Tester avec VoiceOver (10 minutes)
**iPhone** : Réglages → Accessibilité → VoiceOver (ou triple-clic sur le bouton latéral si le raccourci est réglé).
Balayer à droite / à gauche pour passer d'un élément à l'autre, double-toucher pour activer, rotor (rotation à deux
doigts) sur « Titres » pour sauter de titre en titre.
**Mac** : Cmd+F5, puis Ctrl+Option+flèches ; Ctrl+Option+U pour le rotor.

Parcours à vérifier :
1. Page de connexion : « PBP2027, départ dans N jours », champs Email et Mot de passe annoncés, erreur lue.
2. Tableau de bord : titre « Tableau de bord » annoncé ; compte à rebours en une phrase ; menu « Menu » sur iPhone.
3. Calendrier BRM : filtres annoncés (pastilles « 600, appuyé »), bouton « Choisir : BRM 300 Rennes… », statut lu.
4. Roadbook : tableau des contrôles, bouton « Montrer Loudéac, km 412, sur la carte », profil décrit.
5. Pointer : boutons d'état, champ « Petit mot pour les proches », confirmation lue après envoi.
6. Page de suivi des proches (lien partagé) : statut, « dans les temps », journal, météo lisibles dans l'ordre.
7. Strava : sections dépliables annoncées « réduit / développé », récap des KOM lisible ligne par ligne.
