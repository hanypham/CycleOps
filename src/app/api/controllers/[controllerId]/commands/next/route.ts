/**
 * GET /api/controllers/:controllerId/commands/next
 *
 * ESP32 polls this every 3 seconds to check for a pending machine command.
 * Returns the next PENDING command (if any) and marks it as CLAIMED.
 *
 * Key safety rules:
 * - Only returns PENDING commands that haven't expired
 * - A command can only be claimed once
 * - Expired commands are cleaned up on each poll
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateControllerToken } from "@/lib/auth";
import { expireStaleCommands } from "@/lib/machine-control";
import { CommandStatus } from "@prisma/client";

export async function GET(
  req: NextRequest,
  { params }: { params: { controllerId: string } }
) {
  const authHeader = req.headers.get("authorization");
  const controller = await validateControllerToken(authHeader, params.controllerId);

  if (!controller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update last seen
  await db.controller.update({
    where: { id: controller.id },
    data: { lastSeenAt: new Date(), status: "ONLINE" },
  });

  // Clean up expired commands
  await expireStaleCommands();

  // Find next pending command for this controller
  const command = await db.machineCommand.findFirst({
    where: {
      controllerId: controller.id,
      status: CommandStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
    orderBy: { requestedAt: "asc" },
  });

  if (!command) {
    return NextResponse.json({ command: null });
  }

  // Claim the command atomically
  const claimed = await db.machineCommand.updateMany({
    where: {
      id: command.id,
      status: CommandStatus.PENDING, // Double-check status hasn't changed
    },
    data: {
      status: CommandStatus.CLAIMED,
      claimedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    // Race condition — another claim beat us, return no command
    return NextResponse.json({ command: null });
  }

  await db.auditLog.create({
    data: {
      entityType: "machine_command",
      entityId: command.id,
      action: "command.claimed",
      metadata: { controllerId: controller.id },
    },
  });

  return NextResponse.json({
    command: {
      id: command.id,
      type: command.commandType,
      relayDurationMs: command.relayDurationMs,
      machineId: command.machineId,
    },
  });
}
