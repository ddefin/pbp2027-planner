import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { decryptSecret, encryptSecret } from "./secretCrypto.js";

export const VALID_FORMATS = ["discord", "slack", "generic"] as const;
export type WebhookFormat = (typeof VALID_FORMATS)[number];

export const VALID_EVENTS = [
  "sortie.created",
  "sortie.participant_joined",
  "brm.participation_changed",
  "meteo.vent_fort",
] as const;
export type WebhookEvent = (typeof VALID_EVENTS)[number];

export const EVENT_LABEL: Record<WebhookEvent, string> = {
  "sortie.created": "Nouvelle sortie planifiée",
  "sortie.participant_joined": "Un randonneur rejoint une sortie",
  "brm.participation_changed": "Choix sur un BRM du calendrier",
  "meteo.vent_fort": "Vent fort prévu sur un BRM choisi",
};

const DELIVERY_TIMEOUT_MS = 5000;

type EventPayloads = {
  "sortie.created": { titre: string; date: string; lieu: string; createdBy: string };
  "sortie.participant_joined": { titre: string; who: string };
  "brm.participation_changed": { who: string; status: string; distance: number; ville: string; date: string };
  "meteo.vent_fort": { ville: string; distance: number; date: string; windKmh: number; gustsKmh: number | null; direction: string };
};

function humanText<E extends WebhookEvent>(event: E, data: EventPayloads[E]): string {
  switch (event) {
    case "sortie.created": {
      const d = data as EventPayloads["sortie.created"];
      const date = new Date(d.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      return `📅 Nouvelle sortie : "${d.titre}" le ${date} à ${d.lieu} (par ${d.createdBy})`;
    }
    case "sortie.participant_joined": {
      const d = data as EventPayloads["sortie.participant_joined"];
      return `🚴 ${d.who} rejoint la sortie "${d.titre}"`;
    }
    case "brm.participation_changed": {
      const d = data as EventPayloads["brm.participation_changed"];
      const date = new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
      const statusLabel: Record<string, string> = { prevu: "Prévu", inscrit: "Inscrit", fait: "Fait", homologue: "Homologué" };
      return `🗓️ ${d.who} a marqué le BRM ${d.distance}km de ${d.ville} (${date}) comme "${statusLabel[d.status] ?? d.status}"`;
    }
    case "meteo.vent_fort": {
      const d = data as EventPayloads["meteo.vent_fort"];
      const date = new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
      const gusts = d.gustsKmh ? ` (rafales à ${d.gustsKmh} km/h)` : "";
      return `💨 Vent fort annoncé sur le BRM ${d.distance}km de ${d.ville} (${date}) : ${d.windKmh} km/h${gusts}, secteur ${d.direction}`;
    }
    default:
      return "Événement PBP2027";
  }
}

function buildBody(format: WebhookFormat, event: WebhookEvent, data: unknown, secret: string | null): { body: string; signature: string | null } {
  if (format === "discord") {
    return { body: JSON.stringify({ content: humanText(event, data as never) }), signature: null };
  }
  if (format === "slack") {
    return { body: JSON.stringify({ text: humanText(event, data as never) }), signature: null };
  }
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  const signature = secret ? createHmac("sha256", secret).update(payload).digest("hex") : null;
  return { body: payload, signature };
}

type Subscription = { id: string; url: string; format: string; secretEncrypted: string | null };

async function deliver(sub: Subscription, event: WebhookEvent, data: unknown) {
  const secret = sub.secretEncrypted ? decryptSecret(sub.secretEncrypted) : null;
  const { body, signature } = buildBody(sub.format as WebhookFormat, event, data, secret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  let status: "ok" | "error" = "error";
  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-pbp-signature": `sha256=${signature}` } : {}),
      },
      body,
      signal: controller.signal,
    });
    status = res.ok ? "ok" : "error";
  } catch {
    status = "error";
  } finally {
    clearTimeout(timeout);
  }

  await prisma.webhookSubscription
    .update({ where: { id: sub.id }, data: { lastTriggeredAt: new Date(), lastStatus: status } })
    .catch(() => undefined); // l'abonnement a pu être supprimé entre-temps
}

// Diffusé à TOUS les abonnements actifs qui écoutent cet événement, pas seulement ceux
// de l'utilisateur à l'origine de l'action — ce sont des notifications de groupe
// (ex. un webhook Discord pointant sur le salon du club).
export async function triggerWebhooks<E extends WebhookEvent>(event: E, data: EventPayloads[E]): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({ where: { enabled: true } });
  const matching = subs.filter((s) => s.events.split(",").includes(event));
  await Promise.allSettled(matching.map((sub) => deliver(sub, event, data)));
}

// Envoie un événement de test à UN SEUL abonnement, jamais une diffusion de groupe —
// sinon tester son propre webhook spammerait aussi ceux des autres utilisateurs.
export async function sendTestEvent(sub: Subscription): Promise<void> {
  await deliver(sub, "sortie.created", {
    titre: "Ceci est un test",
    date: new Date().toISOString(),
    lieu: "Test",
    createdBy: "pbp2027-planner",
  });
}

// Le secret brut n'est renvoyé qu'une fois, à la création de l'abonnement (comme les
// codes de récupération MFA) ; seule sa version chiffrée est conservée en base.
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export { encryptSecret };
