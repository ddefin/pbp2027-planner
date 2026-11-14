// Barème officiel ACP (Audax Club Parisien) : durée maximale allouée par distance.
// Sert de valeur par défaut à la création ; l'utilisateur peut la corriger si
// l'organisateur applique un barème local différent.
export const OFFICIAL_LIMIT_MINUTES: Record<number, number> = {
  200: 13 * 60 + 30,
  300: 20 * 60,
  400: 27 * 60,
  600: 40 * 60,
  1000: 75 * 60,
};

// Distances qu'on peut enregistrer comme BRM perso. Le compteur de qualification reste sur
// 4 étapes (200, 300, 400, 600) : un 1000 homologué y compte pour l'étape 600
// (voir src/shared/qualification.ts).
export const VALID_DISTANCES = [200, 300, 400, 600, 1000] as const;

// Distances affichées dans le calendrier officiel (catalogue ACP) : les BRM 1000 en plus,
// sans toucher à la qualification ci-dessus.
export const CALENDAR_DISTANCES = [200, 300, 400, 600, 1000] as const;
export type BrmDistance = (typeof VALID_DISTANCES)[number];

export const VALID_STATUSES = ["a-venir", "inscrit", "fait", "homologue"] as const;
export type BrmStatus = (typeof VALID_STATUSES)[number];

// Statuts pour le choix d'un randonneur sur un BRM du calendrier officiel (catalogue ACP).
export const CATALOG_STATUSES = ["prevu", "inscrit", "fait", "homologue"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

// Fenêtre du calendrier officiel affiché (saison de qualification). Partagée par le
// calendrier et les rappels : une seule entrée de cache côté ACP.
export const CATALOG_FROM = "2027-01-01";
export const CATALOG_TO = "2027-06-30";
