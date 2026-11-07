// Barème officiel ACP (Audax Club Parisien) : durée maximale allouée par distance.
// Sert de valeur par défaut à la création ; l'utilisateur peut la corriger si
// l'organisateur applique un barème local différent.
export const OFFICIAL_LIMIT_MINUTES: Record<number, number> = {
  200: 13 * 60 + 30,
  300: 20 * 60,
  400: 27 * 60,
  600: 40 * 60,
};

export const VALID_DISTANCES = [200, 300, 400, 600] as const;
export type BrmDistance = (typeof VALID_DISTANCES)[number];

export const VALID_STATUSES = ["a-venir", "inscrit", "fait", "homologue"] as const;
export type BrmStatus = (typeof VALID_STATUSES)[number];
