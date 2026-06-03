/**
 * Auth helpers for ESP32 controller authentication.
 *
 * Controllers authenticate using a pre-shared token (set at provisioning time).
 * The token is hashed with SHA-256 before storage — we never store the raw token.
 */

import crypto from "crypto";
import { db } from "./db";

/**
 * Hash a raw controller token for storage/comparison.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Validate a controller's Bearer token from request headers.
 * Returns the controller if valid, null otherwise.
 */
export async function validateControllerToken(
  authHeader: string | null,
  controllerId: string
): Promise<{ id: string; machineId: string | null } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const rawToken = authHeader.slice(7);
  const tokenHash = hashToken(rawToken);

  const controller = await db.controller.findFirst({
    where: {
      id: controllerId,
      authTokenHash: tokenHash,
    },
    include: { machines: { select: { id: true } } },
  });

  if (!controller) return null;

  return {
    id: controller.id,
    machineId: controller.machines[0]?.id ?? null,
  };
}

/**
 * Validate the internal API secret for machine start endpoint.
 * This endpoint is backend-only — the frontend must never call it directly.
 */
export function validateInternalSecret(authHeader: string | null): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET is not set");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === secret;
}
