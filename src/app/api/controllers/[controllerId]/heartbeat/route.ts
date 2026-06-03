/**
 * POST /api/controllers/:controllerId/heartbeat
 *
 * ESP32 sends a heartbeat every ~30 seconds.
 * Updates last_seen_at and controller status.
 * If the controller hasn't been seen in >90 seconds, the machine is marked OFFLINE.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateControllerToken } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { controllerId: string } }
) {
  const authHeader = req.headers.get("authorization");
  const controller = await validateControllerToken(authHeader, params.controllerId);

  if (!controller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db.controller.update({
    where: { id: controller.id },
    data: {
      status: "ONLINE",
      lastSeenAt: new Date(),
    },
  });

  // If machine was OFFLINE, transition back to AVAILABLE
  if (controller.machineId) {
    const machine = await db.machine.findUnique({
      where: { id: controller.machineId },
    });
    if (machine?.status === "OFFLINE") {
      await db.machine.update({
        where: { id: controller.machineId },
        data: { status: "AVAILABLE" },
      });
    }
  }

  return NextResponse.json({ ok: true, serverTime: new Date().toISOString() });
}
