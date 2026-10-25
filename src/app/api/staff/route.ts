// src/app/api/staff/route.ts
// الواجهة البرمجية لإدارة خبيرات وأخصائيات التجميل (Salon Staff API)

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

function getSessionFromRequest(req: NextRequest) {
  const cookie = req.cookies.get('salon_session')?.value;
  if (!cookie) return null;
  return verifySessionToken(cookie);
}

// 1. استعراض قائمة الموظفات
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  try {
    const pool = getDbPool();
    const staff = await withTenantDb(pool, session, async (client) => {
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

  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

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

    const pool = getDbPool();
    const newStaff = await withTenantDb(pool, session, async (client, ctx) => {
      // تحديد الفرع: إما الممرر أو الفرع الرئيسي تلقائياً
      let resolvedBranchId = branchId;
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
    console.error('Error creating staff:', err);
    return NextResponse.json({ error: (err as Error).message || 'حدث خطأ أثناء حفظ بيانات الموظفة' }, { status: 500 });
  }
}
