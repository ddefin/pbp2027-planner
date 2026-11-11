import { ApiError } from "../api/auth";

// File d'attente des pointages faits sans réseau : conservés dans le téléphone avec
// leur heure réelle et un identifiant anti-doublon, puis renvoyés dès que la connexion
// revient. Le serveur ignore un identifiant déjà reçu, donc un renvoi est sans risque.

export interface QueuedCheckin {
  roadbookId: string;
  clientId: string;
  km: number;
  lat: number | null;
  lon: number | null;
  source: "gps" | "manuel" | "controle";
  at: string;
}

const KEY = "pbp.checkinQueue";

function load(): QueuedCheckin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(q: QueuedCheckin[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* stockage indisponible : la file vit seulement le temps de la page */
  }
  window.dispatchEvent(new Event("pbp-checkin-queue"));
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}

export function queuedFor(roadbookId: string): QueuedCheckin[] {
  return load().filter((c) => c.roadbookId === roadbookId);
}

export function enqueue(c: QueuedCheckin) {
  save([...load(), c]);
}

// Une erreur réseau (fetch qui échoue) n'est pas une réponse du serveur : on met en file.
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

type Sender = (c: QueuedCheckin, announce: boolean) => Promise<unknown>;

let flushing = false;

// Renvoie les pointages en attente d'un roadbook, du plus ancien au plus récent. Seul le
// dernier est publié sur le canal (sinon le canal recevrait une rafale de résumés).
// Retourne le nombre de pointages envoyés. S'arrête au premier échec réseau.
export async function flushQueue(roadbookId: string, send: Sender): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const pending = queuedFor(roadbookId).sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      try {
        await send(c, i === pending.length - 1);
      } catch (err) {
        if (isNetworkError(err)) break;
        // Refus définitif du serveur (ex. roadbook supprimé) : inutile de réessayer.
      }
      save(load().filter((q) => q.clientId !== c.clientId));
      sent++;
    }
  } finally {
    flushing = false;
  }
  return sent;
}
