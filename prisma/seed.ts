/**
 * Database seed — creates the initial Washer 1 machine for MVP testing.
 * Run: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding CycleOps database...");

  // Create a controller auth token (save this — it goes into ESP32 config.h)
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const controller = await prisma.controller.upsert({
    where: { id: "ctrl-washer-1" },
    update: {},
    create: {
      id: "ctrl-washer-1",
      name: "Controller-Washer-1",
      authTokenHash: tokenHash,
      status: "OFFLINE",
    },
  });

  const machine = await prisma.machine.upsert({
    where: { slug: "washer-1" },
    update: {},
    create: {
      id: "machine-washer-1",
      name: "Washer 1",
      slug: "washer-1",
      type: "WASHER",
      status: "AVAILABLE",
      priceCents: 400, // $4.00 AUD — update to real price
      currency: "AUD",
      cycleDurationMinutes: 35,
      relayDurationMs: 500,
      controllerId: controller.id,
    },
  });

  console.log("✅ Controller created:", controller.id);
  console.log("✅ Machine created:", machine.slug);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔑 CONTROLLER AUTH TOKEN (save this now!)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Controller ID: ${controller.id}`);
  console.log(`   Auth Token:    ${rawToken}`);
  console.log("");
  console.log("   → Paste CONTROLLER_ID and AUTH_TOKEN into esp32/config.h");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
