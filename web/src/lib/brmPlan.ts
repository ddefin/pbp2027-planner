// Données de sorties/chat en dur pour l'instant — à remplacer par un appel API
// (GET /sorties, WebSocket pour le chat) une fois ce backend en place.
// Les BRM, elles, viennent déjà de la vraie API : voir web/src/api/brm.ts.

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
