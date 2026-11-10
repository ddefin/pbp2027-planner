import type { WebhookEventName, WebhookFormat } from "../api/webhooks";

export const FORMAT_OPTIONS: { value: WebhookFormat; label: string }[] = [
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "generic", label: "Générique (JSON signé HMAC)" },
];

export const EVENT_OPTIONS: { value: WebhookEventName; label: string }[] = [
  { value: "brm.participation_changed", label: "Choix sur un BRM du calendrier" },
  { value: "meteo.vent_fort", label: "Vent fort prévu sur un BRM choisi" },
];
