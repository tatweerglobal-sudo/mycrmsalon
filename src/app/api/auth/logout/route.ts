// src/app/api/auth/logout/route.ts
// مسار تسجيل الخروج: إبطال التوكن المباشر على الخادم وتصفير الكوكي

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function POST(req: NextRequest) {
  // حماية ضد هجمات تزوير الطلبات عبر المواقع (CSRF)
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json(
      { error: 'طلب غير مصرح به: مخالفة حماية المصدر (Origin Check Failed).' },
      { status: 403 }
    );
  }

  try {
    const sessionCookie = req.cookies.get('salon_session')?.value;
    if (sessionCookie) {
      const session = verifySessionToken(sessionCookie);
      if (session?.userId) {
        // إبطال الجلسة فعلياً على جانب الخادم عبر استدعاء دالة auth_revoke_user_sessions
        const pool = getDbPool();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.current_user_id', $1, true)", [session.userId]);
          await client.query('SELECT auth_revoke_user_sessions($1)', [session.userId]);
          await client.query('COMMIT');
        } catch (revokeErr) {
          await client.query('ROLLBACK');
          console.error('Server-side session revocation failed:', revokeErr);
          // حظر إعطاء تأكيد كاذب بالنجاح إذا فشل الإبطال الفعلي على الخادم
          return NextResponse.json(
            { error: 'فشل إبطال الجلسة على الخادم، يرجى إعادة المحاولة.' },
            { status: 500 }
          );
        } finally {
          client.release();
        }
      }
    }
  } catch (_e) {
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع أثناء معالجة تسجيل الخروج.' },
      { status: 500 }
    );
  }

  const response = NextResponse.json({
    success: true,
    message: 'تم تسجيل الخروج وإبطال الجلسة بنجاح.',
  });

  // مسح كوكي الجلسة
  response.cookies.set({
    name: 'salon_session',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
