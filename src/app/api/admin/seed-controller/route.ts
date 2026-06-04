import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== "cycleops-setup-2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.controller.upsert({
      where: { id: "ctrl-washer-1" },
      update: {
        authTokenHash:
          "53f07390194326f89076329762c7931b9447a60dda3968f1421201339de98652",
      },
      create: {
        id: "ctrl-washer-1",
        name: "Controller-Washer-1",
        authTokenHash:
          "53f07390194326f89076329762c7931b9447a60dda3968f1421201339de98652",
        status: "OFFLINE",
      },
    });

    await prisma.machine.update({
      where: { slug: "washer-1" },
      data: { controllerId: "ctrl-washer-1" },
    });

    return NextResponse.json({ ok: true, message: "Controller seeded successfully!" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
