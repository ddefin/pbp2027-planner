// Données de planification en dur pour l'instant — à remplacer par un appel API
// (GET /brm, GET /sorties) une fois le backend de suivi BRM en place.

export const PBP_DATE = new Date("2027-08-17T05:00:00");

export type BrmStatus = "a-venir" | "inscrit" | "fait" | "homologue";

export interface BrmEntry {
  dist: 200 | 300 | 400 | 600;
  date: string;
  lieu: string;
  status: BrmStatus;
  temps: string | null;
  limite: string;
}

export const STATUS_LABEL: Record<BrmStatus, string> = {
  "a-venir": "À venir",
  inscrit: "Inscrit",
  fait: "Fait",
  homologue: "Homologué",
};

export const BRM_PLAN: BrmEntry[] = [
  { dist: 200, date: "2027-02-14", lieu: "Rambouillet", status: "homologue", temps: "8h12", limite: "13h30" },
  { dist: 300, date: "2027-03-21", lieu: "Longny-au-Perche", status: "inscrit", temps: null, limite: "20h00" },
  { dist: 400, date: "2027-04-18", lieu: "Chartres", status: "a-venir", temps: null, limite: "27h00" },
  { dist: 600, date: "2027-05-16", lieu: "Gacé", status: "a-venir", temps: null, limite: "40h00" },
];

export interface Sortie {
  id: string;
  titre: string;
  date: string;
  lieu: string;
  participants: string[];
}

export const SORTIES: Sortie[] = [
  { id: "s1", titre: "Sortie reco col du Perche", date: "16 nov. — 7h00", lieu: "Départ Nogent-le-Rotrou", participants: ["JD", "ML", "TR"] },
  { id: "s2", titre: "Rythme BRM 300 — allure cible", date: "23 nov. — 6h30", lieu: "Départ Rambouillet", participants: ["JD", "AF"] },
  { id: "s3", titre: "Sortie nuit + éclairage", date: "30 nov. — 18h00", lieu: "Départ Chartres", participants: ["JD", "ML", "TR", "AF", "SB"] },
];

export interface ChatMessage {
  who: string;
  me: boolean;
  text: string;
}

export const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  s1: [
    { who: "ML", me: false, text: "Météo annonce du vent de face à l'aller, ça te va toujours ?" },
    { who: "Moi", me: true, text: "Oui, on prendra l'abri du bois vers le km 40." },
    { who: "TR", me: false, text: "Je prévois les feux arrière, ambiance brouillard matinal." },
  ],
  s2: [{ who: "AF", me: false, text: "On vise 24 km/h de moyenne glissante pour tenir le barème large ?" }],
  s3: [{ who: "SB", me: false, text: "Qui a un jeu de piles de rechange pour l'éclairage ?" }],
};
