// src/app/api/auth/me/route.ts
// مسار استرجاع بيانات الجلسة النشطة والتحقق الحي مع تعيين سياق RLS داخل معاملة صريحة

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken, validateSessionState, getSessionFromRequest } from '@/lib/auth/session';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function GET(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  try {
    const session = getSessionFromRequest(req);

    if (!session) {
      return NextResponse.json({ error: 'غير مصرح / لا توجد جلسة نشطة' }, { status: 401 });
    }

    // 2. التحقق الحي من قاعدة البيانات (الحساب نشط، التوكن لم يُبطل، الاشتراك ساري، الدور لم يتغير)
    const pool = getDbPool();
    const liveCheck = await validateSessionState(pool, session);

    if (!liveCheck.valid) {
      const response = NextResponse.json({ error: liveCheck.reason || 'تم إبطال الجلسة' }, { status: 401 });
      response.cookies.delete('salon_session');
      return response;
    }

    // 3. جلب بيانات المركز الحالية من جدول tenants تحت سياق RLS الصارم داخل معاملة صريحة (Explicit Transaction)
    const client = await pool.connect();
    let tenantName = 'صالون التجميل';
    let tenantSlug = '';
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_tenant_id', $2, true)",
        [session.userId, session.tenantId]
      );
      const tRes = await client.query('SELECT name, slug FROM tenants WHERE id = $1', [session.tenantId]);
      if (tRes.rows.length > 0) {
        tenantName = tRes.rows[0].name;
        tenantSlug = tRes.rows[0].slug;
      }
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
        name: session.fullName,
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
      activeTenant: {
        id: session.tenantId,
        name: tenantName,
        slug: tenantSlug,
        role: session.role,
        branchId: session.branchId || null,
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
