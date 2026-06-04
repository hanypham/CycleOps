/**
 * POST /api/payment-sessions/:sessionId/pay
 *
 * Accepts a Square payment nonce from the frontend SDK.
 * Charges the payment server-side and issues a machine start command on success.
 *
 * This is the critical path:
 *   Frontend tokenises → sends nonce here → backend charges Square →
 *   on success: creates transaction + machine command → ESP32 picks up → relay pulses
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { issueMachineStartCommand } from "@/lib/machine-control";

const PaySchema = z.object({
  sourceId: z.string().min(1),  // Square nonce from Web Payments SDK
});

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  let body: z.infer<typeof PaySchema>;
  try {
    body = PaySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Load session
  const session = await db.paymentSession.findUnique({
    where: { id: params.sessionId },
    include: { machine: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Guards
  if (session.status !== "PENDING") {
    return NextResponse.json(
      { error: `Session is already ${session.status}` },
      { status: 409 }
    );
  }

  if (new Date() > session.expiresAt) {
    await db.paymentSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });
    await db.machine.update({
      where: { id: session.machineId },
      data: { status: "AVAILABLE" },
    });
    return NextResponse.json({ error: "Session has expired" }, { status: 410 });
  }

  if (session.machine.status !== "PAYMENT_PENDING") {
    return NextResponse.json(
      { error: "Machine is no longer in payment-pending state" },
      { status: 409 }
    );
  }

  // Charge payment
  const provider = getPaymentProvider(session.provider);
  const result = await provider.chargePayment({
    sourceId: body.sourceId,
    amountCents: session.amountCents,
    currency: session.currency,
    idempotencyKey: session.id,  // Session ID as idempotency key — prevents double-charge
    note: `CycleOps — ${session.machine.name}`,
  });

  if (!result.success) {
    // Mark session as failed, release machine
    await db.$transaction([
      db.paymentSession.update({
        where: { id: session.id },
        data: { status: "FAILED" },
      }),
      db.machine.update({
        where: { id: session.machineId },
        data: { status: "AVAILABLE" },
      }),
    ]);

    await db.auditLog.create({
      data: {
        entityType: "payment_session",
        entityId: session.id,
        action: "payment.failed",
        metadata: JSON.parse(JSON.stringify({ provider: session.provider, result })),
      },
    });

    return NextResponse.json(
      { success: false, error: "Payment failed. Please try again." },
      { status: 402 }
    );
  }

  // Payment succeeded — mark session paid
  await db.paymentSession.update({
    where: { id: session.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      providerSessionId: result.providerTransactionId,
    },
  });

  // Best-effort: create transaction record (don't crash if table isn't ready)
  try {
    await db.transaction.create({
      data: {
        machineId: session.machineId,
        paymentSessionId: session.id,
        provider: session.provider,
        providerTransactionId: result.providerTransactionId,
        amountCents: result.amountCents,
        currency: result.currency,
        status: "COMPLETED",
      },
    });
  } catch (txErr) {
    console.error("[Pay] Could not create transaction record:", txErr);
  }

  // Best-effort: audit log
  try {
    await db.auditLog.create({
      data: {
        entityType: "payment_session",
        entityId: session.id,
        action: "payment.completed",
        metadata: {
          provider: session.provider,
          providerTransactionId: result.providerTransactionId,
          amountCents: result.amountCents,
        },
      },
    });
  } catch (auditErr) {
    console.error("[Pay] Could not write audit log:", auditErr);
  }

  // Issue machine start command (best-effort — don't let this crash the payment response)
  let startResult = { success: false, commandId: undefined as string | undefined, error: "Not attempted" };
  try {
    startResult = await issueMachineStartCommand(session.id);
    if (!startResult.success) {
      console.error("[Pay] Machine start command failed after payment:", startResult.error);
      // Try to log, but don't crash if audit_logs table isn't ready
      try {
        await db.auditLog.create({
          data: {
            entityType: "payment_session",
            entityId: session.id,
            action: "machine.start.failed",
            metadata: { error: startResult.error },
          },
        });
      } catch (auditErr) {
        console.error("[Pay] Could not write audit log:", auditErr);
      }
    }
  } catch (cmdErr) {
    console.error("[Pay] issueMachineStartCommand threw:", cmdErr);
  }

  return NextResponse.json({
    success: true,
    sessionId: session.id,
    commandId: startResult.commandId ?? null,
    message: "Payment successful. Machine starting...",
  });
}
