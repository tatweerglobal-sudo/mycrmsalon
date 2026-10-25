// src/app/api/auth/login/route.ts
// مسار تسجيل الدخول الآمن: التحقق من CSRF، قيود المعدل، مطابقة bcrypt، وتذاكر المصادقة اللحظية

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDbPool } from '@/lib/db';
import { PostgresRateLimiter } from '@/lib/auth/rate-limiter';
import { createSessionToken, SESSION_COOKIE_OPTIONS } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import type { SalonRole } from '@/lib/auth/roles';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  // 1. حماية ضد هجمات تزوير الطلبات عبر المواقع (CSRF / Origin Check)
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json(
      { error: 'طلب غير مصرح به: مخالفة حماية المصدر (Origin Check Failed).' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور بشكل صحيح.' },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const rateLimitKey = `login:${clientIp}:${trimmedEmail}`;

    const pool = getDbPool();
    const rateLimiter = new PostgresRateLimiter(pool, 5, 15 * 60); // 5 محاولات خلال 15 دقيقة
    const rateCheck = await rateLimiter.check(rateLimitKey);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `تم تجاوز الحد المسموح من المحاولات. يرجى الانتظار لمدة ${rateCheck.retryAfterSeconds} ثانية قبل المحاولة مجدداً.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds || 60),
          },
        }
      );
    }

    // 2. استعلام المستخدم وتوليد تذكرة مصادقة لحظية مشفرة عبر auth_lookup_user_for_login
    const userRes = await pool.query('SELECT * FROM auth_lookup_user_for_login($1)', [trimmedEmail]);

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
        { status: 401 }
      );
    }

    const user = userRes.rows[0];

    // 3. التحقق من حالة تفعيل الحساب
    if (!user.is_active) {
      return NextResponse.json(
        { error: 'تم تعطيل هذا الحساب. يرجى التواصل مع إدارة صالون التجميل.' },
        { status: 403 }
      );
    }

    // 4. التحقق من قفل الحساب المؤقت
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const waitMinutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return NextResponse.json(
        { error: `تم قفل الحساب مؤقتاً لتكرار المحاولات الخاطئة. يرجى المحاولة بعد ${waitMinutes} دقيقة.` },
        { status: 423 }
      );
    }

    // 5. مقارنة كلمة المرور عبر bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      // تسجيل المحاولة الفاشلة عبر التحقق من تذكرة المصادقة اللحظية
      await pool.query('SELECT auth_record_login_failure($1, $2)', [user.id, user.auth_ticket]);
      return NextResponse.json(
        { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
        { status: 401 }
      );
    }

    // 6. جلب صالونات التجميل المرتبطة بالحساب باستخدام تذكرة المصادقة الصالحة
    const tenantsRes = await pool.query('SELECT * FROM auth_get_user_tenants($1, $2)', [user.id, user.auth_ticket]);

    if (tenantsRes.rows.length === 0 && !user.is_super_admin) {
      return NextResponse.json(
        { error: 'لا توجد عضويات نشطة مرتبطة بهذا الحساب في أي مركز تجميل.' },
        { status: 403 }
      );
    }

    // 7. نجاح المصادقة: تسجيل النجاح وتصفير العدادات واستهلاك/إبطال التذكرة
    await pool.query('SELECT auth_record_login_success($1, $2)', [user.id, user.auth_ticket]);
    await rateLimiter.reset(rateLimitKey);

    const primaryTenant = tenantsRes.rows[0] || {
      tenant_id: '00000000-0000-0000-0000-000000000000',
      tenant_name: 'منصة إدارة صالونات التجميل',
      tenant_slug: 'platform',
      role: 'super_admin',
      branch_id: null,
    };

    // 8. إنشاء رمز الجلسة الموقّع رقمياً بـ HMAC-SHA256
    const sessionToken = createSessionToken({
      userId: user.id,
      tenantId: primaryTenant.tenant_id,
      role: primaryTenant.role as SalonRole,
      branchId: primaryTenant.branch_id,
      email: user.email,
      fullName: user.full_name,
      isSuperAdmin: user.is_super_admin,
      tokenVersion: user.token_version,
    });

    const response = NextResponse.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: primaryTenant.role,
        isSuperAdmin: user.is_super_admin,
        tenant: {
          id: primaryTenant.tenant_id,
          name: primaryTenant.tenant_name,
          slug: primaryTenant.tenant_slug,
        },
      },
    });

    // 9. ضبط كوكي الجلسة الآمنة (HttpOnly, SameSite=None, Secure for cross-origin & iframe)
    response.cookies.set({
      name: SESSION_COOKIE_OPTIONS.name,
      value: sessionToken,
      httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
      secure: true,
      sameSite: 'none',
      path: SESSION_COOKIE_OPTIONS.path,
      maxAge: SESSION_COOKIE_OPTIONS.maxAge,
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع أثناء معالجة تسجيل الدخول.' },
      { status: 500 }
    );
  }
}
