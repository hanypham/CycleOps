/**
 * POST /api/controllers/register
 *
 * Called by ESP32 on first boot to register itself with the backend.
 * The controller must already exist in the DB (created via seed).
 * This endpoint validates the token and returns the controller's machine assignment.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateControllerToken } from "@/lib/auth";

const RegisterSchema = z.object({
  controllerId: z.string().min(1),
  firmwareVersion: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RegisterSchema>;
  try {
    body = RegisterSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization");
  const controller = await validateControllerToken(authHeader, body.controllerId);

  if (!controller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update firmware version and mark online
  const updated = await db.controller.update({
    where: { id: controller.id },
    data: {
      status: "ONLINE",
      lastSeenAt: new Date(),
      firmwareVersion: body.firmwareVersion ?? undefined,
    },
    include: {
      machines: {
        select: {
          id: true,
          name: true,
          slug: true,
          relayDurationMs: true,
        },
      },
    },
  });

  await db.auditLog.create({
    data: {
      entityType: "controller",
      entityId: controller.id,
      action: "controller.registered",
      metadata: { firmwareVersion: body.firmwareVersion },
    },
  });

  return NextResponse.json({
    controllerId: controller.id,
    status: "REGISTERED",
    machines: updated.machines,
  });
}
