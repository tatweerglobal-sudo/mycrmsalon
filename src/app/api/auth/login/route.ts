// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDbPool } from '@/lib/db';
import { PostgresRateLimiter } from '@/lib/auth/rate-limiter';
import { createSessionToken } from '@/lib/auth/session';
import type { SalonRole } from '@/lib/auth/roles';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
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

    // استعلام المستخدم عبر الدالة الآمنة auth_lookup_user_for_login
    const userRes = await pool.query('SELECT * FROM auth_lookup_user_for_login($1)', [trimmedEmail]);

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
        { status: 401 }
      );
    }

    const user = userRes.rows[0];

    // التحقق من حالة تفعيل الحساب
    if (!user.is_active) {
      return NextResponse.json(
        { error: 'تم تعطيل هذا الحساب. يرجى التواصل مع إدارة صالون التجميل.' },
        { status: 403 }
      );
    }

    // التحقق من قفل الحساب المؤقت
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const waitMinutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return NextResponse.json(
        { error: `تم قفل الحساب مؤقتاً لتكرار المحاولات الخاطئة. يرجى المحاولة بعد ${waitMinutes} دقيقة.` },
        { status: 423 }
      );
    }

    // مقارنة كلمة المرور عبر bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      await pool.query('SELECT auth_record_login_failure($1)', [user.id]);
      return NextResponse.json(
        { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
        { status: 401 }
      );
    }

    // نجاح المصادقة: تسجيل النجاح وتصفير العدادات
    await pool.query('SELECT auth_record_login_success($1)', [user.id]);
    await rateLimiter.reset(rateLimitKey);

    // جلب صالونات التجميل المرتبطة بالحساب
    const tenantsRes = await pool.query('SELECT * FROM auth_get_user_tenants($1)', [user.id]);

    if (tenantsRes.rows.length === 0 && !user.is_super_admin) {
      return NextResponse.json(
        { error: 'لا توجد عضويات نشطة مرتبطة بهذا الحساب في أي مركز تجميل.' },
        { status: 403 }
      );
    }

    const primaryTenant = tenantsRes.rows[0] || {
      tenant_id: '00000000-0000-0000-0000-000000000000',
      tenant_name: 'منصة إدارة صالونات التجميل',
      tenant_slug: 'platform',
      role: 'super_admin',
      branch_id: null,
    };

    // إنشاء رمز الجلسة المشفر والموقع
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

    // ضبط كوكي الجلسة الآمنة HttpOnly
    response.cookies.set({
      name: 'salon_session',
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12 ساعة
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
