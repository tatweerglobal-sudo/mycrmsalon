// src/middleware.ts
// حماية المسارات على مستوى خادم الويب (Edge / Server Middleware)
// التحقق الإلزامي من الجلسة ومنع وصول المستخدمين المجهولين (Anonymous) لمسارات الـ CRM

import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionInEdge } from '@/lib/auth/edge-session';

// المسارات المستثناة من الفحص الأمني (الملفات الثابتة ومسار فحص الصحة ومسار تسجيل الدخول)
const PUBLIC_API_PATHS = ['/api/health', '/api/auth/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. تجاوز الملفات الثابتة والمسارات المخصصة لـ Next.js
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/static')
  ) {
    return NextResponse.next();
  }

  // 2. تجاوز نقاط النهاية العامة للـ API
  if (PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // 3. قراءة كوكي الجلسة والتحقق من التوقيع والصلاحية
  const sessionCookie = request.cookies.get('salon_session')?.value;
  const session = sessionCookie ? await verifySessionInEdge(sessionCookie) : null;

  // 4. معالجة صفحة تسجيل الدخول (/login)
  if (pathname === '/login') {
    // إذا كان المستخدم مسجل دخول بالفعل بجلسة صالحة، تحويله مباشرة إلى لوحة التحكم
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 5. حماية كافة المسارات المحمية (لوحة التحكم، العملاء، المواعيد، الإحصائيات، والـ APIs)
  if (!session) {
    // إذا كان الطلب إلى مسار API محمي، إعادة 401 بدلاً من التحويل
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'غير مصرح به: يلزم تسجيل الدخول للوصول إلى بيانات المركز (Unauthorized).' },
        { status: 401 }
      );
    }

    // إذا كان طلباً لصفحة CRM (لوحة التحكم أو الأقسام)، إعادة التوجيه الفوري لصفحة الدخول
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);

    // مسح الكوكي التالف أو منتهي الصلاحية إن وجد
    if (sessionCookie) {
      response.cookies.delete('salon_session');
    }
    return response;
  }

  // 6. جلسة صالحة ومؤكدة -> السماح بالمرور
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * تطبيق الـ Middleware على جميع المسارات عدا ملفات الأصول
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
