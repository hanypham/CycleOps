/**
 * One-time DB migration — adds missing columns to machine_commands and controllers.
 * Visit: /api/admin/migrate?secret=cycleops-setup-2026
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== "cycleops-setup-2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: string[] = [];

  const migrations = [
    // machine_commands — extra columns from Prisma schema
    `ALTER TABLE machine_commands ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE machine_commands ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`,
    `ALTER TABLE machine_commands ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ`,
    `ALTER TABLE machine_commands ADD COLUMN IF NOT EXISTS result_message TEXT`,
    `ALTER TABLE machine_commands ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    // controllers — extra columns
    `ALTER TABLE controllers ADD COLUMN IF NOT EXISTS firmware_version TEXT`,
    `ALTER TABLE controllers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  ];

  for (const sql of migrations) {
    try {
      await db.$executeRawUnsafe(sql);
      results.push(`OK: ${sql.slice(0, 80)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`SKIP: ${sql.slice(0, 80)} — ${msg}`);
    }
  }

  return NextResponse.json({ ok: true, results });
}
