/**
 * POST /api/payment-sessions
 *
 * Creates a new payment session for a machine.
 * Called when the customer is ready to pay.
 * Returns session ID + Square credentials for the frontend SDK.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const SESSION_EXPIRY_MINUTES = 5;

const CreateSessionSchema = z.object({
  machineId: z.string().min(1),  // Machine slug (e.g. "washer-1")
});

export async function POST(req: NextRequest) {
  // Rate limit: max 5 session creation attempts per IP per minute
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rateLimit = checkRateLimit(`session-create:${ip}`, {
    maxRequests: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  // Validate body
  let body: z.infer<typeof CreateSessionSchema>;
  try {
    body = CreateSessionSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Look up machine by slug
  const machine = await db.machine.findUnique({
    where: { slug: body.machineId },
  });

  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }

  // Guard: machine must be AVAILABLE
  if (machine.status !== "AVAILABLE") {
    return NextResponse.json(
      {
        error: "Machine is not available",
        status: machine.status,
      },
      { status: 409 }
    );
  }

  // Guard: no active session already exists for this machine
  const activeSession = await db.paymentSession.findFirst({
    where: {
      machineId: machine.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });

  if (activeSession) {
    return NextResponse.json(
      { error: "A payment session is already active for this machine." },
      { status: 409 }
    );
  }

  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

  // Create session + lock machine in a transaction
  const session = await db.$transaction(async (tx) => {
    const s = await tx.paymentSession.create({
      data: {
        machineId: machine.id,
        provider: "square",
        amountCents: machine.priceCents,
        currency: machine.currency,
        status: "PENDING",
        expiresAt,
      },
    });

    await tx.machine.update({
      where: { id: machine.id },
      data: { status: "PAYMENT_PENDING" },
    });

    return s;
  });

  // Audit log
  await db.auditLog.create({
    data: {
      entityType: "payment_session",
      entityId: session.id,
      action: "session.created",
      metadata: { machineId: machine.id, amountCents: machine.priceCents },
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    machineId: machine.id,
    machineName: machine.name,
    machineSlug: machine.slug,
    amountCents: session.amountCents,
    currency: session.currency,
    expiresAt: session.expiresAt.toISOString(),
    // Square frontend SDK credentials (safe to expose)
    squareAppId: process.env.NEXT_PUBLIC_SQUARE_APP_ID,
    squareLocationId: process.env.SQUARE_LOCATION_ID,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT ?? "sandbox",
  });
}
