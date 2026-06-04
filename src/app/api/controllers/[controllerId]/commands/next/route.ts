/**
 * GET /api/controllers/:controllerId/commands/next
 *
 * ESP32 polls this every 3 seconds to check for a pending machine command.
 * Returns the next PENDING command (if any) and marks it as CLAIMED.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateControllerToken } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { controllerId: string } }
) {
  try {
    // Step 1: Auth
    const authHeader = req.headers.get("authorization");
    const controller = await validateControllerToken(authHeader, params.controllerId);

    if (!controller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Step 2: Update last seen
    await db.controller.update({
      where: { id: controller.id },
      data: { lastSeenAt: new Date(), status: "ONLINE" },
    });

    // Step 3: Expire stale commands using raw SQL to avoid enum issues
    await db.$executeRaw`
      UPDATE machine_commands
      SET status = 'EXPIRED', updated_at = NOW()
      WHERE status = 'PENDING'
        AND expires_at < NOW()
    `;

    // Step 4: Find next pending command using raw SQL
    const commands = await db.$queryRaw<Array<{
      id: string;
      command_type: string;
      relay_duration_ms: number;
      machine_id: string;
    }>>`
      SELECT id, command_type, relay_duration_ms, machine_id
      FROM machine_commands
      WHERE controller_id = ${controller.id}
        AND status = 'PENDING'
        AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (!commands || commands.length === 0) {
      return NextResponse.json({ command: null });
    }

    const command = commands[0];

    // Step 5: Claim atomically
    const result = await db.$executeRaw`
      UPDATE machine_commands
      SET status = 'CLAIMED', claimed_at = NOW(), updated_at = NOW()
      WHERE id = ${command.id}
        AND status = 'PENDING'
    `;

    if (result === 0) {
      return NextResponse.json({ command: null });
    }

    return NextResponse.json({
      command: {
        id: command.id,
        type: command.command_type,
        relayDurationMs: command.relay_duration_ms,
        machineId: command.machine_id,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Poll] Error:", message);
    // Return real error temporarily for debugging
    return NextResponse.json({ error: "Internal server error", detail: message }, { status: 500 });
  }
}
