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

  // 2. تجاوز نقاط النهاية العامة للـ API والصفحات العامة المفتوحة
  if (
    pathname === '/suspended' ||
    pathname === '/invite' ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/api/auth/setup-password') ||
    PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  // 3. قراءة توكن الجلسة (من الكوكي، أو ترويسة Authorization، أو معلمة الرابط st)
  const authHeader = request.headers.get('authorization');
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const tokenParam = request.nextUrl.searchParams.get('st');
  const sessionToken = request.cookies.get('salon_session')?.value || bearerToken || tokenParam;
  const session = sessionToken ? await verifySessionInEdge(sessionToken) : null;

  // 4. معالجة صفحة تسجيل الدخول (/login)
  if (pathname === '/login') {
    // إذا كان المستخدم مسجل دخول بالفعل بجلسة صالحة، تحويله مباشرة إلى لوحة التحكم
    if (session) {
      const redirectUrl = new URL('/', request.url);
      if (tokenParam) {
        redirectUrl.searchParams.set('st', tokenParam);
      }
      return NextResponse.redirect(redirectUrl);
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
    if (request.cookies.has('salon_session')) {
      response.cookies.delete('salon_session');
    }
    return response;
  }

  // 5.5 حماية مسارات مدير المنصة الأعلى (/admin و /api/admin) ومنع غير مديري المنصة إطلاقاً
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (!session.isSuperAdmin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'غير مصرح به: هذه الواجهة مخصصة لمدير المنصة (Super Admin) فقط.' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // 6. جلسة صالحة ومؤكدة -> تمرير التوكن في ترويسات الطلب للمكونات الخادمة والـ APIs
  const requestHeaders = new Headers(request.headers);
  if (sessionToken) {
    requestHeaders.set('x-session-token', sessionToken);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // تعزيز حفظ الكوكي في الرد أيضاً
  if (sessionToken && !request.cookies.has('salon_session')) {
    response.cookies.set({
      name: 'salon_session',
      value: sessionToken,
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 43200,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * تطبيق الـ Middleware على جميع المسارات عدا ملفات الأصول
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
