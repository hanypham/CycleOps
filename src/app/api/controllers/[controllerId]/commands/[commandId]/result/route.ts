/**
 * POST /api/controllers/:controllerId/commands/:commandId/result
 *
 * ESP32 reports the result of executing a command (relay pulse success/failure).
 * This is the final step in the machine start chain.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateControllerToken } from "@/lib/auth";
import { CommandStatus, MachineStatus } from "@prisma/client";

const ResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { controllerId: string; commandId: string } }
) {
  const authHeader = req.headers.get("authorization");
  const controller = await validateControllerToken(authHeader, params.controllerId);

  if (!controller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof ResultSchema>;
  try {
    body = ResultSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Load command and verify ownership
  const command = await db.machineCommand.findFirst({
    where: {
      id: params.commandId,
      controllerId: controller.id,
      status: CommandStatus.CLAIMED,
    },
  });

  if (!command) {
    // May be duplicate result report — check if already EXECUTED
    const existing = await db.machineCommand.findFirst({
      where: { id: params.commandId, controllerId: controller.id },
    });
    if (existing?.status === "EXECUTED" || existing?.status === "FAILED") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json(
      { error: "Command not found or not in CLAIMED state" },
      { status: 404 }
    );
  }

  const newCommandStatus = body.success ? CommandStatus.EXECUTED : CommandStatus.FAILED;
  const newMachineStatus = body.success ? MachineStatus.RUNNING : MachineStatus.AVAILABLE;

  await db.$transaction([
    db.machineCommand.update({
      where: { id: command.id },
      data: {
        status: newCommandStatus,
        executedAt: new Date(),
        resultMessage: body.message ?? null,
      },
    }),
    db.machine.update({
      where: { id: command.machineId },
      data: { status: newMachineStatus },
    }),
  ]);

  await db.auditLog.create({
    data: {
      entityType: "machine_command",
      entityId: command.id,
      action: body.success ? "command.executed" : "command.failed",
      metadata: {
        controllerId: controller.id,
        machineId: command.machineId,
        message: body.message,
      },
    },
  });

  // If RUNNING, schedule transition back to AVAILABLE after cycle duration
  // (In production, use a proper job queue. For MVP, this is a fire-and-forget timeout.)
  if (body.success) {
    const machine = await db.machine.findUnique({
      where: { id: command.machineId },
      select: { cycleDurationMinutes: true },
    });

    if (machine) {
      const durationMs = machine.cycleDurationMinutes * 60 * 1000;
      setTimeout(async () => {
        try {
          // Only reset if still RUNNING (operator may have disabled it)
          await db.machine.updateMany({
            where: { id: command.machineId, status: MachineStatus.RUNNING },
            data: { status: MachineStatus.AVAILABLE },
          });
          console.log(`[Machine] ${command.machineId} cycle complete — back to AVAILABLE`);
        } catch (err) {
          console.error("[Machine] Failed to reset status after cycle:", err);
        }
      }, durationMs);
    }
  }

  return NextResponse.json({ ok: true, status: newCommandStatus });
}
