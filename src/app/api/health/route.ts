import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

// في وضع التصدير الثابت (Static Export) يتم استخدام الوضع التلقائي لتوليد استجابة استعراضية،
// بينما في وضع الخادم الحقيقي (Node.js Dynamic) يتم فرض التشغيل الديناميكي لفحص قاعدة البيانات الحية
export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'unconfigured';
  let latencyMs = 0;

  // فحص الاتصال بقاعدة البيانات في حال توفر المتغير البيئي
  if (process.env.SALON_DATABASE_URL || (process.env.NODE_ENV === 'test' && process.env.SALON_TEST_DATABASE_URL)) {
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
  }

  const payload = {
    status: dbStatus === 'degraded' ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    service: 'My CRM Salon SaaS Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      latencyMs: dbStatus === 'connected' ? latencyMs : undefined,
    },
  };

  return NextResponse.json(payload, {
    status: dbStatus === 'degraded' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
