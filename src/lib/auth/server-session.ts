// src/lib/auth/server-session.ts
// التحقق الإلزامي من الجلسة على مستوى مكونات السيرفر (Server Components)
// حماية ضد تجاوز الـ Middleware وضمان عدم تسريب أي بيانات حساسة للمستخدمين المجهولين
// يتحقق مباشرة من قاعدة بيانات Neon لحالة المستخدم والعضوية والصالون وعدم إبطال التوكن (token_version)

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDbPool } from '@/lib/db';
import { verifySessionToken, validateSessionState, type SessionPayload } from './session';

export async function requireServerSession(): Promise<SessionPayload> {
  // دعم أمر بناء التصدير الثابت المؤقت دون خطأ في cookies()
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return {
      userId: 'mock-export-user',
      tenantId: 'mock-export-tenant',
      role: 'salon_owner',
      email: 'owner@crmsalon.de',
      fullName: 'معاينة تجريبية',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
  }

  const cookieStore = cookies();
  const headersList = headers();
  const token = cookieStore.get('salon_session')?.value || headersList.get('x-session-token');
  if (!token) {
    redirect('/login');
  }

  const session = verifySessionToken(token);
  if (!session) {
    redirect('/login');
  }

  // التحقق المباشر من قاعدة بيانات Neon لحالة الجلسة الحية (Stateful Verification)
  // يفحص: حالة المستخدم، إبطال التوكن token_version، الدور الوظيفي، وعضوية الصالون
  try {
    const pool = getDbPool();
    const stateCheck = await validateSessionState(pool, session);
    if (!stateCheck.valid) {
      console.warn(`[ServerSession] Revoked/invalid session rejected for ${session.email}: ${stateCheck.reason}`);
      if (stateCheck.reason?.includes('موقوف') || stateCheck.reason?.includes('معلق') || stateCheck.reason?.includes('اشتراك')) {
        redirect('/suspended');
      }
      redirect('/login');
    }
  } catch (err) {
    // إذا كان الاستثناء ناتجاً عن دالة redirect في Next.js، أعد رميه
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    console.error('[ServerSession] Database validation error:', err);
    redirect('/login');
  }

  return session;
}
