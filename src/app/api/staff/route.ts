// src/app/api/staff/route.ts
// الواجهة البرمجية لإدارة خبيرات وأخصائيات التجميل (Salon Staff API)
// مع التحقق الحي من الجلسة في Neon وفرض صلاحية staff:manage وفحص حدود الباقة

import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض قائمة الموظفات
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const staff = await withTenantDb(auth.pool, auth.session, async (client) => {
      const res = await client.query(`
        SELECT s.id, s.display_name, s.title, s.commission_rate, s.is_active,
               s.branch_id, b.name as branch_name, s.created_at
        FROM salon_staff s
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.is_active = true
        ORDER BY s.display_name ASC
      `);
      return res.rows;
    });

    return NextResponse.json({ success: true, staff });
  } catch (err: unknown) {
    console.error('Error fetching staff:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة الموظفات' }, { status: 500 });
  }
}

// 2. إضافة موظفة جديدة
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { permission: 'staff:manage' });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { displayName, title, branchId, commissionRate } = body;

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2) {
      return NextResponse.json({ error: 'اسم الموظفة مطلوب ولا يقل عن حرفين' }, { status: 400 });
    }

    const rate = Number(commissionRate ?? 0);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ error: 'نسبة العمولة يجب أن تكون بين 0% و 100%' }, { status: 400 });
    }

    const newStaff = await withTenantDb(auth.pool, auth.session, async (client, ctx) => {
      // فحص عدم تجاوز الحد الأقصى للموظفات وفق باقة الاشتراك
      const tenantRes = await client.query(
        'SELECT max_staff, (SELECT COUNT(*) FROM salon_staff WHERE tenant_id = $1 AND is_active = true) as current_staff FROM tenants WHERE id = $1',
        [ctx.tenantId]
      );
      if (tenantRes.rows.length > 0) {
        const { max_staff, current_staff } = tenantRes.rows[0];
        if (parseInt(current_staff, 10) >= max_staff) {
          throw new Error(`لقد بلغت الحد الأقصى لعدد الموظفات في باقتك الحالية (${max_staff} موظفة). يرجى ترقية الباقة لإضافة المزيد.`);
        }
      }

      // تحديد الفرع: إما الممرر أو الفرع الرئيسي تلقائياً
      let resolvedBranchId = branchId || ctx.branchId;
      if (!resolvedBranchId) {
        const mainBranch = await client.query('SELECT id FROM branches WHERE is_main = true LIMIT 1');
        resolvedBranchId = mainBranch.rows[0]?.id;
        if (!resolvedBranchId) {
          const anyBranch = await client.query('SELECT id FROM branches LIMIT 1');
          resolvedBranchId = anyBranch.rows[0]?.id;
        }
      }

      if (!resolvedBranchId) {
        throw new Error('لا يوجد فرع معرف للصالون، يرجى إضافة فرع أولاً');
      }

      const res = await client.query(`
        INSERT INTO salon_staff (
          tenant_id, branch_id, display_name, title, commission_rate, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, true
        ) RETURNING id, display_name, title, commission_rate, branch_id, created_at;
      `, [
        ctx.tenantId,
        resolvedBranchId,
        displayName.trim(),
        title?.trim() || 'أخصائية تجميل',
        rate
      ]);

      return res.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة الموظفة بنجاح',
      staff: newStaff,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('الحد الأقصى')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    console.error('Error creating staff:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ بيانات الموظفة' }, { status: 500 });
  }
}
