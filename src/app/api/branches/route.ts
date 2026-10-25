// src/app/api/branches/route.ts
// الواجهة البرمجية لإدارة فروع مركز التجميل (Branches API)

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

// 1. استعراض الفروع
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  try {
    const pool = getDbPool();
    const branches = await withTenantDb(pool, session, async (client) => {
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

// 2. إضافة فرع جديد
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
    const { name, phone, address, city, openingTime, closingTime, isMain } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'اسم الفرع مطلوب ويجب ألا يقل عن حرفين' }, { status: 400 });
    }

    const pool = getDbPool();
    const newBranch = await withTenantDb(pool, session, async (client, ctx) => {
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
    console.error('Error creating branch:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ بيانات الفرع' }, { status: 500 });
  }
}
