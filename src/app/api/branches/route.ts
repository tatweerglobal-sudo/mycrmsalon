// src/app/api/branches/route.ts
// الواجهة البرمجية لإدارة فروع مركز التجميل (Branches API)
// مع التحقق الحي من الجلسة في Neon وفرض صلاحية branches:manage

import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض الفروع
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const branches = await withTenantDb(auth.pool, auth.session, async (client) => {
      const res = await client.query(`
        SELECT id, name, phone, address, city, is_main, is_active,
               opening_time, closing_time, created_at
        FROM branches
        WHERE is_active = true
        ORDER BY is_main DESC, name ASC
      `);
      return res.rows;
    });

    return NextResponse.json({ success: true, branches });
  } catch (err: unknown) {
    console.error('Error fetching branches:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة الفروع' }, { status: 500 });
  }
}

// 2. إضافة فرع جديد (يتطلب صلاحية branches:manage)
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { permission: 'branches:manage' });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { name, phone, address, city, openingTime, closingTime, isMain } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'اسم الفرع مطلوب ويجب ألا يقل عن حرفين' }, { status: 400 });
    }

    const newBranch = await withTenantDb(auth.pool, auth.session, async (client, ctx) => {
      // فحص عدم تجاوز الحد الأقصى للفروع وفق باقة الاشتراك
      const tenantRes = await client.query(
        'SELECT max_branches, (SELECT COUNT(*) FROM branches WHERE tenant_id = $1) as current_branches FROM tenants WHERE id = $1',
        [ctx.tenantId]
      );
      if (tenantRes.rows.length > 0) {
        const { max_branches, current_branches } = tenantRes.rows[0];
        if (parseInt(current_branches, 10) >= max_branches) {
          throw new Error(`لقد بلغت الحد الأقصى للفروع المسموح بها في باقتك الحالية (${max_branches} فرع). يرجى ترقية الباقة لإضافة فروع جديدة.`);
        }
      }

      // فحص عدم تكرار الاسم
      const dup = await client.query('SELECT id FROM branches WHERE name = $1 LIMIT 1', [name.trim()]);
      if (dup.rows.length > 0) {
        throw new Error('يوجد فرع مسجل بهذا الاسم مسبقاً');
      }

      const res = await client.query(`
        INSERT INTO branches (
          tenant_id, name, phone, address, city, opening_time, closing_time, is_main, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, true
        ) RETURNING id, name, phone, city, is_main, created_at;
      `, [
        ctx.tenantId,
        name.trim(),
        phone?.trim() || null,
        address?.trim() || null,
        city?.trim() || 'الرياض',
        openingTime || '09:00:00',
        closingTime || '22:00:00',
        Boolean(isMain)
      ]);

      return res.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة الفرع بنجاح',
      branch: newBranch,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('مسجل بهذا الاسم')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes('الحد الأقصى')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    console.error('Error creating branch:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ بيانات الفرع' }, { status: 500 });
  }
}
