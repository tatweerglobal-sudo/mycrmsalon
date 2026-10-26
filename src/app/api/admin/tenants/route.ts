// src/app/api/admin/tenants/route.ts
// الواجهة البرمجية الموحدة لإدارة المنصة والمستأجرين (Super Admin Tenants Management)
// تدعم البحث، التصفية، تسجيل الصالونات في معاملة ذرية متكاملة، توليد روابط الدعوة، وتعليق/تفعيل الاشتراكات مع إبطال الجلسات

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getMigrationDbPool } from '@/lib/db';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { normalizePhone } from '@/lib/phone-normalizer';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض كافة مراكز التجميل مع التصفية والبحث ومؤشرات المنصة
export async function GET(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const auth = await requireApiAuth(req, { requireSuperAdmin: true });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q')?.trim() || searchParams.get('search')?.trim() || '';
  const statusFilter = searchParams.get('status')?.trim() || '';

  try {
    const pool = getMigrationDbPool();

    let baseQuery = `
      SELECT 
        t.id,
        t.name,
        t.slug,
        t.country_code,
        t.currency,
        t.timezone,
        t.status,
        t.subscription_tier,
        t.subscription_expires_at,
        t.max_branches,
        t.max_staff,
        t.contact_phone,
        t.contact_email,
        t.created_at,
        t.updated_at,
        (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branches_count,
        (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.is_active = true) as staff_count,
        (SELECT u.full_name FROM memberships m2 JOIN users u ON u.id = m2.user_id WHERE m2.tenant_id = t.id AND m2.role = 'salon_owner' LIMIT 1) as owner_name,
        (SELECT u.email FROM memberships m2 JOIN users u ON u.id = m2.user_id WHERE m2.tenant_id = t.id AND m2.role = 'salon_owner' LIMIT 1) as owner_email,
        (SELECT i.token FROM tenant_invitations i WHERE i.tenant_id = t.id AND i.used_at IS NULL AND i.expires_at > NOW() ORDER BY i.created_at DESC LIMIT 1) as active_invite_token
      FROM tenants t
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let pIdx = 1;

    if (statusFilter && statusFilter !== 'all') {
      baseQuery += ` AND t.status = $${pIdx++}`;
      params.push(statusFilter);
    }

    if (search) {
      baseQuery += ` AND (t.name ILIKE $${pIdx} OR t.slug ILIKE $${pIdx} OR t.contact_email ILIKE $${pIdx} OR t.contact_phone ILIKE $${pIdx})`;
      params.push(`%${search}%`);
      pIdx++;
    }

    baseQuery += ` ORDER BY t.created_at DESC`;

    const res = await pool.query(baseQuery, params);

    // حساب مؤشرات المنصة الإجمالية
    const kpiRes = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'trial') as trial,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
        COUNT(*) FILTER (WHERE status = 'pending_activation') as pending_activation
      FROM tenants
    `);

    const kpi = kpiRes.rows[0];

    const protocol = req.nextUrl.protocol || 'https:';
    const host = req.headers.get('host') || 'crmsalon.de';
    const baseUrl = `${protocol}//${host}`;

    const formattedTenants = res.rows.map((row) => ({
      ...row,
      invite_url: row.active_invite_token ? `${baseUrl}/invite?token=${row.active_invite_token}` : null,
    }));

    return NextResponse.json({
      tenants: formattedTenants,
      kpis: {
        totalTenants: parseInt(kpi.total, 10),
        activeTenants: parseInt(kpi.active, 10),
        trialTenants: parseInt(kpi.trial, 10),
        suspendedTenants: parseInt(kpi.suspended, 10),
        pendingActivationTenants: parseInt(kpi.pending_activation, 10),
      },
    });
  } catch (error) {
    console.error('Admin tenants GET error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء استعلام قائمة مراكز التجميل' }, { status: 500 });
  }
}

// 2. تسجيل مركز تجميل جديد وإنشاء حساب المالك والفرع الرئيسي في معاملة ذرية متكاملة
export async function POST(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { requireSuperAdmin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      name,
      slug,
      country_code = 'SA',
      currency = 'SAR',
      subscription_tier = 'starter',
      status = 'active',
      max_branches = 1,
      max_staff = 5,
      owner_name,
      owner_email,
      owner_password,
      owner_phone,
    } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'اسم مركز التجميل مطلوب.' }, { status: 400 });
    }

    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      return NextResponse.json({ error: 'معرف النطاق (Slug) مطلوب ويجب أن يكون بالإنجليزية.' }, { status: 400 });
    }

    if (!owner_email || typeof owner_email !== 'string' || !owner_email.trim()) {
      return NextResponse.json({ error: 'البريد الإلكتروني لمالك المركز مطلوب.' }, { status: 400 });
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const cleanOwnerEmail = owner_email.trim().toLowerCase();
    const cleanOwnerName = (owner_name || name).trim();
    let cleanPhone: string | null = null;
    if (owner_phone && typeof owner_phone === 'string') {
      const norm = normalizePhone(owner_phone, (country_code || 'SA') as any);
      cleanPhone = norm.isValid ? norm.phoneNormalized : owner_phone.trim().slice(0, 50);
    }

    const pool = getMigrationDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. فحص عدم تكرار النطاق (Slug)
      const existingSlug = await client.query('SELECT id FROM tenants WHERE slug = $1', [cleanSlug]);
      if (existingSlug.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `معرف النطاق "${cleanSlug}" مستخدم مسبقاً، يرجى اختيار معرف آخر.` }, { status: 409 });
      }

      // 2. إنشاء مركز التجميل (Tenant)
      const tenantRes = await client.query(
        `INSERT INTO tenants (
          name, slug, country_code, currency, timezone, status, subscription_tier,
          max_branches, max_staff, contact_phone, contact_email
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, name, slug, status, subscription_tier`,
        [
          name.trim(),
          cleanSlug,
          country_code.toUpperCase(),
          currency.toUpperCase(),
          country_code === 'EG' ? 'Africa/Cairo' : 'Asia/Riyadh',
          status,
          subscription_tier,
          Number(max_branches) || 1,
          Number(max_staff) || 5,
          cleanPhone,
          cleanOwnerEmail,
        ]
      );
      const newTenant = tenantRes.rows[0];

      // 3. إنشاء الفرع الرئيسي الافتراضي للمركز (Main Branch)
      const branchRes = await client.query(
        `INSERT INTO branches (
          tenant_id, name, phone, is_main, is_active
        ) VALUES ($1, $2, $3, true, true)
        RETURNING id, name`,
        [newTenant.id, 'الفرع الرئيسي', cleanPhone]
      );
      const mainBranch = branchRes.rows[0];

      // 4. التحقق من وجود المستخدم أو إنشاؤه
      let userId: string;
      const userRes = await client.query('SELECT id FROM users WHERE email = $1', [cleanOwnerEmail]);
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      } else {
        // إذا تم إدخال كلمة مرور نستخدمها، وإلا نولد رمز عشوائي مشفر لحين قبول الدعوة
        const initialPassword = (owner_password && owner_password.length >= 8)
          ? owner_password
          : crypto.randomBytes(16).toString('hex') + 'A1!';
        const passwordHash = await bcrypt.hash(initialPassword, 10);

        const newUserRes = await client.query(
          `INSERT INTO users (
            email, phone_normalized, full_name, password_hash, is_super_admin, is_active
          ) VALUES ($1, $2, $3, $4, false, true)
          RETURNING id`,
          [cleanOwnerEmail, cleanPhone, cleanOwnerName, passwordHash]
        );
        userId = newUserRes.rows[0].id;
      }

      // 5. إنشاء العضوية بدور مالك الصالون (salon_owner)
      await client.query(
        `INSERT INTO memberships (
          tenant_id, user_id, role, branch_id, is_active
        ) VALUES ($1, $2, 'salon_owner', $3, true)
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'salon_owner', is_active = true`,
        [newTenant.id, userId, mainBranch.id]
      );

      // 6. توليد رمز دعوة آمن لتعيين كلمة المرور وتفعيل الحساب
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 أيام

      await client.query(
        `INSERT INTO tenant_invitations (
           tenant_id, email, role, token, expires_at, created_by
         ) VALUES ($1, $2, 'salon_owner', $3, $4, $5)`,
        [newTenant.id, cleanOwnerEmail, inviteToken, expiresAt, auth.userId]
      );

      // 7. تسجيل التدقيق الإداري
      await client.query(
        `INSERT INTO audit_logs (
           tenant_id, user_id, action, resource_type, resource_id, details
         ) VALUES ($1, $2, 'tenant_created', 'tenant', $3, $4)`,
        [
          newTenant.id,
          auth.userId,
          newTenant.id,
          JSON.stringify({
            name: newTenant.name,
            slug: newTenant.slug,
            subscription_tier,
            status,
            owner_email: cleanOwnerEmail,
          }),
        ]
      );

      await client.query('COMMIT');

      const protocol = req.nextUrl.protocol || 'https:';
      const host = req.headers.get('host') || 'crmsalon.de';
      const inviteUrl = `${protocol}//${host}/invite?token=${inviteToken}`;

      return NextResponse.json({
        success: true,
        message: 'تم تسجيل مركز التجميل وإنشاء حساب المالك والفرع الرئيسي ورابط الدعوة بنجاح.',
        tenant: {
          id: newTenant.id,
          name: newTenant.name,
          slug: newTenant.slug,
          status: newTenant.status,
          subscription_tier: newTenant.subscription_tier,
          owner: {
            name: cleanOwnerName,
            email: cleanOwnerEmail,
          },
          invitation: {
            token: inviteToken,
            inviteUrl,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin tenants POST error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع أثناء تسجيل مركز التجميل.' }, { status: 500 });
  }
}

// 3. تعديل حالة اشتراك مركز التجميل (تفعيل، إيقاف، تغيير الباقة) مع إبطال الجلسات
export async function PATCH(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { requireSuperAdmin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { tenant_id, status, subscription_tier, max_branches, max_staff } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'معرف مركز التجميل (tenant_id) مطلوب.' }, { status: 400 });
    }

    const pool = getMigrationDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const updates: string[] = [];
      const params: unknown[] = [tenant_id];
      let pIdx = 2;

      if (status && ['pending_activation', 'trial', 'active', 'suspended', 'cancelled'].includes(status)) {
        updates.push(`status = $${pIdx++}`);
        params.push(status);
      }

      if (subscription_tier && ['trial', 'starter', 'growth', 'enterprise'].includes(subscription_tier)) {
        updates.push(`subscription_tier = $${pIdx++}`);
        params.push(subscription_tier);
      }

      if (max_branches !== undefined) {
        updates.push(`max_branches = $${pIdx++}`);
        params.push(Number(max_branches) || 1);
      }

      if (max_staff !== undefined) {
        updates.push(`max_staff = $${pIdx++}`);
        params.push(Number(max_staff) || 5);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'لا توجد حقول للتحديث.' }, { status: 400 });
      }

      updates.push('updated_at = NOW()');

      const updateQuery = `
        UPDATE tenants
        SET ${updates.join(', ')}
        WHERE id = $1
        RETURNING id, name, slug, status, subscription_tier, max_branches, max_staff
      `;

      const res = await client.query(updateQuery, params);
      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'مركز التجميل غير موجود.' }, { status: 404 });
      }

      const updatedTenant = res.rows[0];

      // إذا تم تعليق أو إلغاء الصالون، يتم إبطال كافة الجلسات الحية للمستخدمين التابعين له فوراً
      if (status === 'suspended' || status === 'cancelled') {
        await client.query(
          `UPDATE users
           SET token_version = token_version + 1, updated_at = NOW()
           WHERE id IN (SELECT user_id FROM memberships WHERE tenant_id = $1)`,
          [tenant_id]
        );
      }

      // تسجيل العملية في audit_logs
      await client.query(
        `INSERT INTO audit_logs (
           tenant_id, user_id, action, resource_type, resource_id, details
         ) VALUES ($1, $2, $3, 'tenant', $4, $5)`,
        [
          tenant_id,
          auth.userId,
          status === 'suspended' ? 'tenant_suspended' : status === 'active' ? 'tenant_reactivated' : 'tenant_updated',
          tenant_id,
          JSON.stringify({ status, subscription_tier, max_branches, max_staff }),
        ]
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: 'تم تحديث بيانات واشتراك المركز بنجاح.',
        tenant: updatedTenant,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin tenants PATCH error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء تحديث بيانات مركز التجميل.' }, { status: 500 });
  }
}
