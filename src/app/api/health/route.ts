import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  const isStaticExport = process.env.NEXT_OUTPUT_EXPORT === 'true';

  if (isStaticExport) {
    return NextResponse.json({
      status: 'static-preview',
      timestamp: new Date().toISOString(),
      service: 'My CRM Salon SaaS Backend',
      version: '1.0.0',
      environment: 'static-export',
      database: {
        status: 'static-mock',
        message: 'Static export preview mode without server-side database connectivity.',
      },
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const isConfigured = Boolean(
    process.env.SALON_DATABASE_URL ||
    (process.env.NODE_ENV === 'test' && process.env.SALON_TEST_DATABASE_URL)
  );

  if (!isConfigured) {
    return NextResponse.json({
      status: 'unconfigured',
      timestamp: new Date().toISOString(),
      service: 'My CRM Salon SaaS Backend',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: {
        status: 'unconfigured',
        error: 'Database connection string (SALON_DATABASE_URL) is not configured.',
      },
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let dbStatus = 'disconnected';
  let latencyMs = 0;

  try {
    const pool = getDbPool();
    const res = await pool.query('SELECT 1 AS alive');
    if (res.rows?.[0]?.alive === 1) {
      dbStatus = 'connected';
      latencyMs = Date.now() - startTime;
    }
  } catch {
    dbStatus = 'degraded';
  }

  const isHealthy = dbStatus === 'connected';

  const payload = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'My CRM Salon SaaS Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      latencyMs: isHealthy ? latencyMs : undefined,
      error: !isHealthy ? 'Database query failed or timed out.' : undefined,
    },
  };

  return NextResponse.json(payload, {
    status: isHealthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
