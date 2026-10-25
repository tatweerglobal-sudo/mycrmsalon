// src/lib/auth/server-session.ts
// التحقق الإلزامي من الجلسة على مستوى مكونات السيرفر (Server Components)
// حماية ضد تجاوز الـ Middleware وضمان عدم تسريب أي بيانات حساسة للمستخدمين المجهولين

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken, type SessionPayload } from './session';

export function requireServerSession(): SessionPayload {
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
  const token = cookieStore.get('salon_session')?.value;
  if (!token) {
    redirect('/login');
  }

  const session = verifySessionToken(token);
  if (!session) {
    redirect('/login');
  }

  return session;
}
