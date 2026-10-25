// src/app/api/admin/tenants/route.ts
// الواجهة البرمجية لإدارة المنصة والمستأجرين (Platform Super Admin Tenants API)
// تتيح لمالك المنصة استعراض جميع مراكز التجميل، تسجيل صالونات جديدة، وتعديل حالات الاشتراكات

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getMigrationDbPool } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { normalizePhone } from '@/lib/phone-normalizer';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض كافة مراكز التجميل والمؤشرات العامة للمنصة
export async function GET(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const session = getSessionFromRequest(req);
  if (!session || !session.isSuperAdmin) {
    return NextResponse.json(
      { error: 'غير مصرح به: هذه اللوحة مخصصة لإدارة المنصة العليا (Super Admin) فقط.' },
      { status: 403 }
    );
  }

  try {
    const pool = getMigrationDbPool();

    // جلب قائمة المراكز مع بيانات المالك وإحصائيات الفروع والموظفين
    const query = `
      SELECT 
        t.id,
        t.name,
        t.slug,
        t.country_code,
        t.currency,
        t.status,
        t.subscription_tier,
        t.subscription_expires_at,
        t.max_branches,
        t.max_staff,
        t.contact_phone,
        t.contact_email,
        t.created_at,
        (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branches_count,
        (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.is_active = true) as staff_count,
        (SELECT u.full_name FROM memberships m2 JOIN users u ON u.id = m2.user_id WHERE m2.tenant_id = t.id AND m2.role = 'salon_owner' LIMIT 1) as owner_name,
        (SELECT u.email FROM memberships m2 JOIN users u ON u.id = m2.user_id WHERE m2.tenant_id = t.id AND m2.role = 'salon_owner' LIMIT 1) as owner_email
      FROM tenants t
      ORDER BY t.created_at DESC
    `;

    const res = await pool.query(query);

    // حساب مؤشرات المنصة الإجمالية
    const totalTenants = res.rows.length;
    const activeTenants = res.rows.filter((r) => r.status === 'active').length;
    const trialTenants = res.rows.filter((r) => r.status === 'trial').length;
    const suspendedTenants = res.rows.filter((r) => r.status === 'suspended').length;

    return NextResponse.json({
      tenants: res.rows,
      kpis: {
        totalTenants,
        activeTenants,
        trialTenants,
        suspendedTenants,
      },
    });
  } catch (error) {
    console.error('Admin tenants GET error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة مراكز التجميل' }, { status: 500 });
  }
}

// 2. تسجيل مركز تجميل جديد وإنشاء حساب المالك والفرع الرئيسي في معاملة واحدة متكاملة
export async function POST(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر' }, { status: 403 });
  }

  const session = getSessionFromRequest(req);
  if (!session || !session.isSuperAdmin) {
    return NextResponse.json(
      { error: 'غير مصرح به: صلاحية إنشاء مراكز تجميل جديدة مقتصرة على Super Admin.' },
      { status: 403 }
    );
  }

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

    if (!owner_password || typeof owner_password !== 'string' || owner_password.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور الابتدائية مطلوبة ويجب أن لا تقل عن 8 خانات.' }, { status: 400 });
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

      // فحص عدم تكرار النطاق (Slug)
      const existingSlug = await client.query('SELECT id FROM tenants WHERE slug = $1', [cleanSlug]);
      if (existingSlug.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `معرف النطاق "${cleanSlug}" مستخدم مسبقاً، يرجى اختيار معرف آخر.` }, { status: 409 });
      }

      // 1. إنشاء مركز التجميل (Tenant)
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

      // 2. إنشاء الفرع الرئيسي الافتراضي للمركز (Main Branch)
      const branchRes = await client.query(
        `INSERT INTO branches (
          tenant_id, name, phone, is_main, is_active
        ) VALUES ($1, $2, $3, true, true)
        RETURNING id, name`,
        [newTenant.id, 'الفرع الرئيسي', cleanPhone]
      );
      const mainBranch = branchRes.rows[0];

      // 3. التحقق من وجود المستخدم أو إنشاؤه
      let userId: string;
      const userRes = await client.query('SELECT id FROM users WHERE email = $1', [cleanOwnerEmail]);
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      } else {
        const passwordHash = await bcrypt.hash(owner_password, 10);
        const newUserRes = await client.query(
          `INSERT INTO users (
            email, phone_normalized, full_name, password_hash, is_super_admin, is_active
          ) VALUES ($1, $2, $3, $4, false, true)
          RETURNING id`,
          [cleanOwnerEmail, cleanPhone, cleanOwnerName, passwordHash]
        );
        userId = newUserRes.rows[0].id;
      }

      // 4. إنشاء العضوية بدور مالك الصالون (salon_owner)
      await client.query(
        `INSERT INTO memberships (
          tenant_id, user_id, role, branch_id, is_active
        ) VALUES ($1, $2, 'salon_owner', $3, true)
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'salon_owner', is_active = true`,
        [newTenant.id, userId, mainBranch.id]
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: 'تم تسجيل مركز التجميل وإنشاء حساب المالك والفرع الرئيسي بنجاح.',
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

// 3. تعديل حالة اشتراك مركز التجميل (تفعيل، إيقاف، تغيير الباقة)
export async function PATCH(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر' }, { status: 403 });
  }

  const session = getSessionFromRequest(req);
  if (!session || !session.isSuperAdmin) {
    return NextResponse.json({ error: 'غير مصرح به: مخصص لـ Super Admin فقط.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { tenant_id, status, subscription_tier, max_branches, max_staff } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'معرف مركز التجميل (tenant_id) مطلوب.' }, { status: 400 });
    }

    const pool = getMigrationDbPool();
    const updates: string[] = [];
    const params: unknown[] = [tenant_id];
    let pIdx = 2;

    if (status && ['trial', 'active', 'suspended', 'cancelled'].includes(status)) {
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
      return NextResponse.json({ error: 'لا توجد حقول للتحديث.' }, { status: 400 });
    }

    updates.push('updated_at = NOW()');

    const updateQuery = `
      UPDATE tenants
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING id, name, slug, status, subscription_tier, max_branches, max_staff
    `;

    const res = await pool.query(updateQuery, params);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'مركز التجميل غير موجود.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم تحديث بيانات واشتراك المركز بنجاح.',
      tenant: res.rows[0],
    });
  } catch (error) {
    console.error('Admin tenants PATCH error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء تحديث بيانات مركز التجميل.' }, { status: 500 });
  }
}
