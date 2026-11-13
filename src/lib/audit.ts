import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import type { AdminUser } from "./adminGuard.js";

export interface AuditInput {
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /pass|token|secret|hash|cookie/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[masqué]" : redact(v)]));
  }
  return value;
}

// Renvoie l'écriture SANS l'exécuter : à placer dans la même transaction que l'action.
// Si le journal ne peut pas être écrit, l'action est annulée (aucune action sans trace).
export function auditEntry(request: FastifyRequest, actor: AdminUser, e: AuditInput) {
  return prisma.adminAuditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      targetLabel: e.targetLabel.slice(0, 200),
      metadata: e.metadata ? JSON.stringify(redact(e.metadata)).slice(0, 4000) : null,
      ip: request.ip ?? null,
      userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300) || null,
    },
  });
}
