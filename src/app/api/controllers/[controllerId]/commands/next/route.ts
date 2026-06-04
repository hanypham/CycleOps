/**
 * GET /api/controllers/:controllerId/commands/next
 *
 * ESP32 polls this every 3 seconds to check for a pending machine command.
 * Returns the next PENDING command (if any) and marks it as CLAIMED.
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
  try {
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
      orderBy: { createdAt: "asc" },
    });

    if (!command) {
      return NextResponse.json({ command: null });
    }

    // Claim the command atomically
    const claimed = await db.machineCommand.updateMany({
      where: {
        id: command.id,
        status: CommandStatus.PENDING,
      },
      data: {
        status: CommandStatus.CLAIMED,
      },
    });

    if (claimed.count === 0) {
      return NextResponse.json({ command: null });
    }

    return NextResponse.json({
      command: {
        id: command.id,
        type: command.commandType,
        relayDurationMs: command.relayDurationMs,
        machineId: command.machineId,
      },
    });
  } catch (err) {
    console.error("[Poll] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
