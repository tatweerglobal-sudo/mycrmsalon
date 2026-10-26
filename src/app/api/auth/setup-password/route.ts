// src/app/api/auth/setup-password/route.ts
// التحقق من رمز الدعوة وتعيين كلمة المرور لمالك الصالون الجديد

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getMigrationDbPool } from '@/lib/db';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { createSessionToken, SESSION_COOKIE_OPTIONS } from '@/lib/auth/session';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعلام بيانات الدعوة للتحقق منها قبل إدخال كلمة المرور
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim();
  if (!token) {
    return NextResponse.json({ error: 'رمز الدعوة مطلوب' }, { status: 400 });
  }

  try {
    const pool = getMigrationDbPool();
    const res = await pool.query(
      `SELECT i.id, i.email, i.role, i.expires_at, i.used_at,
              t.id as tenant_id, t.name as tenant_name, t.slug as tenant_slug,
              u.full_name as owner_name
       FROM tenant_invitations i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN users u ON u.email = i.email
       WHERE i.token = $1 LIMIT 1`,
      [token]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'رمز الدعوة غير صالح أو غير موجود' }, { status: 404 });
    }

    const invite = res.rows[0];

    if (invite.used_at) {
      return NextResponse.json({ error: 'تم استخدام رابط هذه الدعوة مسبقاً' }, { status: 410 });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'انتهت صلاحية رابط الدعوة، يرجى طلب رابط جديد' }, { status: 410 });
    }

    return NextResponse.json({
      valid: true,
      email: invite.email,
      salonName: invite.tenant_name,
      ownerName: invite.owner_name || 'مالك المركز',
    });
  } catch (err) {
    console.error('Check invite error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء فحص رمز الدعوة' }, { status: 500 });
  }
}

// 2. تفعيل الحساب وحفظ كلمة المرور الجديدة
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { token, password } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'رمز الدعوة مطلوب' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور مطلوبة ويجب ألا تقل عن 8 خانات' }, { status: 400 });
    }

    const pool = getMigrationDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const inviteRes = await client.query(
        `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, i.used_at,
                t.status as tenant_status, t.name as tenant_name,
                u.id as user_id, u.full_name
         FROM tenant_invitations i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN users u ON u.email = i.email
         WHERE i.token = $1 FOR UPDATE OF i LIMIT 1`,
        [token]
      );

      if (inviteRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'رمز الدعوة غير صالح أو غير موجود' }, { status: 404 });
      }

      const invite = inviteRes.rows[0];

      if (invite.used_at) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'تم استخدام رابط هذه الدعوة مسبقاً' }, { status: 410 });
      }

      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'انتهت صلاحية رابط الدعوة، يرجى طلب رابط جديد من الإدارة' }, { status: 410 });
      }

      // تشفير كلمة المرور بـ bcrypt
      const passwordHash = await bcrypt.hash(password, 10);

      let userId = invite.user_id;

      if (userId) {
        // تحديث كلمة المرور وتنشيط المستخدم
        await client.query(
          `UPDATE users
           SET password_hash = $1, is_active = true, token_version = token_version + 1, updated_at = NOW()
           WHERE id = $2`,
          [passwordHash, userId]
        );
      } else {
        // إنشاء المستخدم إذا لم يكن موجوداً
        const newUserRes = await client.query(
          `INSERT INTO users (
             email, full_name, password_hash, is_super_admin, is_active
           ) VALUES ($1, $2, $3, false, true)
           RETURNING id`,
          [invite.email, invite.full_name || 'مالك المركز', passwordHash]
        );
        userId = newUserRes.rows[0].id;
      }

      // التأكد من العضوية وتفعيلها
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET is_active = true, role = $3`,
        [invite.tenant_id, userId, invite.role || 'salon_owner']
      );

      // إذا كان الصالون pending_activation، نقوم بتفعيله إلى active
      if (invite.tenant_status === 'pending_activation') {
        await client.query(
          `UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
          [invite.tenant_id]
        );
      }

      // تعليم الدعوة كمستخدمة
      await client.query(
        `UPDATE tenant_invitations SET used_at = NOW() WHERE id = $1`,
        [invite.id]
      );

      // تسجيل العملية في audit_logs
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, 'password_setup_completed', 'user', $3, $4)`,
        [invite.tenant_id, userId, userId, JSON.stringify({ email: invite.email })]
      );

      await client.query('COMMIT');

      // إنشاء جلسة دخول مباشرة للمالك
      const sessionToken = createSessionToken({
        userId,
        tenantId: invite.tenant_id,
        role: (invite.role || 'salon_owner') as any,
        isSuperAdmin: false,
        email: invite.email,
        fullName: invite.full_name || 'مالك المركز',
        tokenVersion: 1,
      });

      const response = NextResponse.json({
        success: true,
        message: 'تم تفعيل حسابك وإعداد كلمة المرور بنجاح!',
        token: sessionToken,
        salonName: invite.tenant_name,
      });

      response.cookies.set({
        ...SESSION_COOKIE_OPTIONS,
        value: sessionToken,
      });

      return response;
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Setup password error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع أثناء إعداد كلمة المرور' }, { status: 500 });
  }
}
