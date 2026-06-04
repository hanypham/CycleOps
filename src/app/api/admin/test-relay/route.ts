/**
 * POST /api/admin/test-relay
 *
 * Developer-only endpoint — injects a START command directly into the DB
 * so you can test the relay without making a real payment.
 *
 * Protected by secret query param: ?secret=cycleops-setup-2026
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const ADMIN_SECRET = "cycleops-setup-2026";

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find washer-1 machine
    const machineResult = await db.$queryRawUnsafe<{ id: string; controller_id: string | null }[]>(
      `SELECT id, controller_id FROM machines WHERE slug = 'washer-1' LIMIT 1`
    );

    if (!machineResult.length) {
      return NextResponse.json({ error: "Machine washer-1 not found" }, { status: 404 });
    }

    const machine = machineResult[0];

    if (!machine.controller_id) {
      return NextResponse.json({ error: "Machine has no controller assigned" }, { status: 400 });
    }

    // Create a fake payment session for tracking
    const sessionId = `test-${Date.now()}`;
    await db.$executeRawUnsafe(
      `INSERT INTO payment_sessions (id, machine_id, status, amount_cents, currency, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'COMPLETED', 0, 'AUD', NOW() + INTERVAL '1 hour', NOW(), NOW())`,
      sessionId,
      machine.id
    );

    // Create the START command
    const commandId = `cmd-test-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

    await db.$executeRawUnsafe(
      `INSERT INTO machine_commands
         (id, machine_id, controller_id, payment_session_id, command_type, status,
          relay_duration_ms, expires_at, requested_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'START', 'PENDING', 500, $5, NOW(), NOW(), NOW())`,
      commandId,
      machine.id,
      machine.controller_id,
      sessionId,
      expiresAt
    );

    return NextResponse.json({ ok: true, sessionId, commandId });
  } catch (err) {
    console.error("[test-relay] Error:", err);
    return NextResponse.json(
      { error: "Internal error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
