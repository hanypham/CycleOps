/**
 * POST /api/payment-webhooks/:provider
 *
 * Receives webhook events from payment providers.
 * Verifies signature, prevents duplicate processing, creates machine commands.
 *
 * This is the authoritative payment confirmation path.
 * The frontend payment success screen alone cannot start a machine.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { issueMachineStartCommand } from "@/lib/machine-control";

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  // Get raw body for signature verification
  const rawBody = await req.text();

  // Build headers object for provider
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });

  let webhookResult;
  try {
    const provider = getPaymentProvider(params.provider);
    webhookResult = await provider.receiveWebhook(rawBody, headers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing error";
    console.error("[Webhook] Error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Idempotency: ignore duplicate events
  const existingEvent = await db.webhookEvent.findUnique({
    where: { providerEventId: webhookResult.eventId },
  });

  if (existingEvent) {
    console.log(`[Webhook] Duplicate event ignored: ${webhookResult.eventId}`);
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Find payment session by provider payment ID
  const session = await db.paymentSession.findFirst({
    where: { providerSessionId: webhookResult.paymentId },
  });

  // Store webhook event (always, even if no session found)
  await db.webhookEvent.create({
    data: {
      provider: params.provider,
      providerEventId: webhookResult.eventId,
      eventType: webhookResult.eventType,
      paymentSessionId: session?.id ?? null,
      rawPayload: JSON.parse(JSON.stringify(webhookResult.rawPayload)),
      processedAt: new Date(),
    },
  });

  if (!session) {
    // Could be a webhook for a different payment — log and acknowledge
    console.warn(`[Webhook] No session found for payment: ${webhookResult.paymentId}`);
    return NextResponse.json({ received: true });
  }

  // Only process successful payment events
  if (!webhookResult.success) {
    if (session.status === "PENDING") {
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
    }
    return NextResponse.json({ received: true });
  }

  // Guard: only process PAID once
  if (session.status === "PAID") {
    console.log(`[Webhook] Session already PAID: ${session.id}`);
    return NextResponse.json({ received: true });
  }

  // Mark session as paid (if not already done via the /pay endpoint)
  if (session.status === "PENDING") {
    await db.paymentSession.update({
      where: { id: session.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    // Create transaction record if not already created
    const existing = await db.transaction.findUnique({
      where: { paymentSessionId: session.id },
    });

    if (!existing) {
      await db.transaction.create({
        data: {
          machineId: session.machineId,
          paymentSessionId: session.id,
          provider: params.provider,
          providerTransactionId: webhookResult.paymentId,
          amountCents: session.amountCents,
          currency: session.currency,
          status: "COMPLETED",
        },
      });
    }
  }

  // Issue machine start command (idempotent — safe to call again)
  const startResult = await issueMachineStartCommand(session.id);
  if (!startResult.success) {
    console.error("[Webhook] Machine start failed:", startResult.error);
  }

  return NextResponse.json({ received: true });
}
