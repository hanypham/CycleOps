/**
 * GET /api/payment-sessions/:sessionId
 *
 * Returns current payment session status.
 * Polled by the frontend to track payment + machine start progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const session = await db.paymentSession.findUnique({
    where: { id: params.sessionId },
    include: {
      machine: {
        select: { id: true, name: true, slug: true, status: true },
      },
      machineCommand: {
        select: { id: true, status: true, executedAt: true },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Check expiry
  const isExpired = session.status === "PENDING" && new Date() > session.expiresAt;
  if (isExpired) {
    // Mark as expired and release machine
    await db.$transaction([
      db.paymentSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      }),
      db.machine.update({
        where: { id: session.machineId },
        data: { status: "AVAILABLE" },
      }),
    ]);

    return NextResponse.json({
      sessionId: session.id,
      status: "EXPIRED",
      machine: session.machine,
      machineCommand: null,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    amountCents: session.amountCents,
    currency: session.currency,
    paidAt: session.paidAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    machine: {
      ...session.machine,
    },
    machineCommand: session.machineCommand
      ? {
          id: session.machineCommand.id,
          status: session.machineCommand.status,
          executedAt: session.machineCommand.executedAt?.toISOString() ?? null,
        }
      : null,
  });
}
