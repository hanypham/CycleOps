import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== 'cycleops-setup-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Reset stuck machines from PAYMENT_PENDING / STARTING back to AVAILABLE
    const resetMachines = await db.$executeRaw`
      UPDATE machines
      SET status = 'AVAILABLE', updated_at = NOW()
      WHERE status IN ('PAYMENT_PENDING', 'STARTING')
    `;

    // Expire stuck PENDING payment sessions
    const expiredSessions = await db.$executeRaw`
      UPDATE payment_sessions
      SET status = 'EXPIRED', updated_at = NOW()
      WHERE status = 'PENDING'
    `;

    // Expire stuck PENDING commands
    const expiredCommands = await db.$executeRaw`
      UPDATE machine_commands
      SET status = 'EXPIRED'
      WHERE status = 'PENDING'
    `;

    return NextResponse.json({
      ok: true,
      message: 'Machine reset successfully!',
      resetMachines,
      expiredSessions,
      expiredCommands,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
