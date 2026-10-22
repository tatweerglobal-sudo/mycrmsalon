// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken, validateSessionState } from '@/lib/auth/session';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function GET(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  try {
    const sessionCookie = req.cookies.get('salon_session')?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: 'غير مصرح / لا توجد جلسة نشطة' }, { status: 401 });
    }

    // فحص توقيع وصلاحية التوكن (HMAC-SHA256)
    const session = verifySessionToken(sessionCookie);
    if (!session) {
      const response = NextResponse.json({ error: 'رمز الجلسة غير صالح أو منتهي الصلاحية' }, { status: 401 });
      response.cookies.delete('salon_session');
      return response;
    }

    // التحقق الحي من قاعدة البيانات (عدم تعطيل الحساب، إصدار التوكن، حالة الاشتراك)
    const pool = getDbPool();
    const liveCheck = await validateSessionState(pool, session);

    if (!liveCheck.valid) {
      const response = NextResponse.json({ error: liveCheck.reason || 'تم إبطال الجلسة' }, { status: 401 });
      response.cookies.delete('salon_session');
      return response;
    }

    // جلب بيانات المركز الحالية من جدول tenants تحت سياق RLS
    const client = await pool.connect();
    let tenantName = 'صالون التجميل';
    let tenantSlug = '';
    try {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [session.tenantId]);
      const tRes = await client.query('SELECT name, slug FROM tenants WHERE id = $1', [session.tenantId]);
      if (tRes.rows.length > 0) {
        tenantName = tRes.rows[0].name;
        tenantSlug = tRes.rows[0].slug;
      }
    } finally {
      client.release();
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        role: session.role,
        branchId: session.branchId || null,
        isSuperAdmin: session.isSuperAdmin || false,
        tenant: {
          id: session.tenantId,
          name: tenantName,
          slug: tenantSlug,
        },
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Me endpoint error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء التحقق من الجلسة' }, { status: 500 });
  }
}
