/**
 * Machine Control — backend-only logic for starting machines.
 *
 * This module is the single source of truth for machine start logic.
 * It never imports from payments/ — it doesn't know or care which
 * payment provider was used.
 */

import { db } from "./db";
import { MachineStatus, CommandStatus } from "@prisma/client";

// Command expires if ESP32 doesn't claim it within this window
const COMMAND_EXPIRY_SECONDS = 30;

export interface StartMachineResult {
  success: boolean;
  commandId?: string;
  error?: string;
}

/**
 * Issue a machine start command after verified payment.
 * Called only from the payment webhook handler or server-side payment verification.
 */
export async function issueMachineStartCommand(
  paymentSessionId: string
): Promise<StartMachineResult> {
  // Load session with machine
  const session = await db.paymentSession.findUnique({
    where: { id: paymentSessionId },
    include: { machine: true },
  });

  if (!session) {
    return { success: false, error: "Payment session not found" };
  }

  if (session.status !== "PAID") {
    return { success: false, error: `Session status is ${session.status}, expected PAID` };
  }

  // Guard: no duplicate commands
  const existingCommand = await db.machineCommand.findUnique({
    where: { paymentSessionId },
  });
  if (existingCommand) {
    console.warn(`[MachineControl] Command already exists for session ${paymentSessionId}`);
    return { success: true, commandId: existingCommand.id }; // idempotent
  }

  const machine = session.machine;

  // Guard: machine must have a controller
  if (!machine.controllerId) {
    return { success: false, error: "Machine has no controller assigned" };
  }

  // Create machine command + update machine status in one transaction
  const [command] = await db.$transaction([
    db.machineCommand.create({
      data: {
        machineId: machine.id,
        controllerId: machine.controllerId,
        paymentSessionId,
        commandType: "START",
        status: CommandStatus.PENDING,
        relayDurationMs: machine.relayDurationMs,
        expiresAt: new Date(Date.now() + COMMAND_EXPIRY_SECONDS * 1000),
      },
    }),
    db.machine.update({
      where: { id: machine.id },
      data: { status: MachineStatus.STARTING },
    }),
  ]);

  // Audit log
  await db.auditLog.create({
    data: {
      entityType: "machine_command",
      entityId: command.id,
      action: "command.created",
      metadata: {
        machineId: machine.id,
        paymentSessionId,
        relayDurationMs: machine.relayDurationMs,
      },
    },
  });

  return { success: true, commandId: command.id };
}

/**
 * Mark a machine as AVAILABLE again (after failure/expiry).
 */
export async function releaseMachine(machineId: string): Promise<void> {
  await db.machine.update({
    where: { id: machineId },
    data: { status: MachineStatus.AVAILABLE },
  });
}

/**
 * Disable a machine (operator action).
 */
export async function disableMachine(machineId: string): Promise<void> {
  await db.machine.update({
    where: { id: machineId },
    data: { status: MachineStatus.DISABLED },
  });

  await db.auditLog.create({
    data: {
      entityType: "machine",
      entityId: machineId,
      action: "machine.disabled",
    },
  });
}

/**
 * Re-enable a machine (operator action).
 */
export async function enableMachine(machineId: string): Promise<void> {
  await db.machine.update({
    where: { id: machineId },
    data: { status: MachineStatus.AVAILABLE },
  });

  await db.auditLog.create({
    data: {
      entityType: "machine",
      entityId: machineId,
      action: "machine.enabled",
    },
  });
}

/**
 * Expire pending commands that weren't claimed in time.
 * Call this from a cron job or on each poll request.
 */
export async function expireStaleCommands(): Promise<void> {
  const expired = await db.machineCommand.updateMany({
    where: {
      status: CommandStatus.PENDING,
      expiresAt: { lt: new Date() },
    },
    data: { status: CommandStatus.EXPIRED },
  });

  if (expired.count > 0) {
    console.log(`[MachineControl] Expired ${expired.count} stale command(s)`);
  }
}
