/**
 * GET /api/machines/:machineId
 *
 * Returns machine details, price, status, and availability.
 * Called by the frontend when the customer taps the NFC tag.
 * machineId here is the URL slug (e.g. "washer-1"), not the DB UUID.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { machineId: string } }
) {
  const machine = await db.machine.findUnique({
    where: { slug: params.machineId },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      priceCents: true,
      currency: true,
      cycleDurationMinutes: true,
    },
  });

  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }

  const canPay = machine.status === "AVAILABLE";

  return NextResponse.json({
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
    type: machine.type,
    status: machine.status,
    priceCents: machine.priceCents,
    currency: machine.currency,
    cycleDurationMinutes: machine.cycleDurationMinutes,
    canPay,
    unavailableReason: canPay ? null : getUnavailableReason(machine.status),
  });
}

function getUnavailableReason(status: string): string {
  switch (status) {
    case "PAYMENT_PENDING": return "Someone is currently paying for this machine. Please wait a moment.";
    case "STARTING":        return "This machine is starting up. Please wait.";
    case "RUNNING":         return "This machine is currently in use.";
    case "OFFLINE":         return "This machine is currently offline. Please try again or use another machine.";
    case "DISABLED":        return "This machine is temporarily out of service.";
    default:                return "This machine is not available right now.";
  }
}
