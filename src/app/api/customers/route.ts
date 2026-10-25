// src/app/api/customers/route.ts
// الواجهة البرمجية لإدارة العملاء في مركز التجميل (Customers CRM API)
// تنفيذ العمليات الفعلية مع قاعدة بيانات Neon وفرض عزل المستأجرين (RLS) وتطبيع أرقام الهواتف

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken, getSessionFromRequest } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';
import { normalizePhone } from '@/lib/phone-normalizer';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض والبحث في قائمة العملاء
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q')?.trim() || '';

  try {
    const pool = getDbPool();
    const customers = await withTenantDb(pool, session, async (client, ctx) => {
      let query = `
        SELECT id, full_name, phone_raw, phone_normalized, email, notes, preferences,
               loyalty_points, total_visits, total_spent, last_visit_at, is_active, created_at
        FROM customers
        WHERE is_active = true
      `;
      const params: unknown[] = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (full_name ILIKE $1 OR phone_normalized ILIKE $1 OR email ILIKE $1)`;
      }

      query += ` ORDER BY created_at DESC LIMIT 100`;

      const res = await client.query(query, params);
      return res.rows;
    });

    return NextResponse.json({ success: true, customers });
  } catch (err: unknown) {
    console.error('Error fetching customers:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة العملاء' }, { status: 500 });
  }
}

// 2. إضافة عميلة جديدة
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
    const { fullName, phone, email, notes, preferences } = body;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return NextResponse.json({ error: 'اسم العميلة مطلوب ويجب ألا يقل عن حرفين' }, { status: 400 });
    }

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'رقم الهاتف مطلوب' }, { status: 400 });
    }

    // تطبيع رقم الهاتف بالصيغة الدولية E.164
    const normalized = normalizePhone(phone, 'SA');
    if (!normalized.isValid || !normalized.phoneNormalized) {
      return NextResponse.json({ error: normalized.error || 'رقم الهاتف غير صالح، يرجى إدخال رقم صحيح (مثال: 0501234567)' }, { status: 400 });
    }

    const pool = getDbPool();
    const newCustomer = await withTenantDb(pool, session, async (client, ctx) => {
      // التحقق من عدم تكرار الهاتف داخل نفس الصالون
      const checkDup = await client.query(
        'SELECT id, full_name FROM customers WHERE phone_normalized = $1 LIMIT 1',
        [normalized.phoneNormalized]
      );
      if (checkDup.rows.length > 0) {
        throw new Error(`رقم الهاتف مسجل مسبقاً للعميلة: "${checkDup.rows[0].full_name}"`);
      }

      const insertRes = await client.query(`
        INSERT INTO customers (
          tenant_id, full_name, phone_raw, phone_normalized, country_code,
          email, notes, preferences
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        ) RETURNING id, full_name, phone_normalized, email, created_at;
      `, [
        ctx.tenantId,
        fullName.trim(),
        phone.trim(),
        normalized.phoneNormalized,
        normalized.countryCode || 'SA',
        email?.trim() || null,
        notes?.trim() || null,
        preferences?.trim() || null
      ]);

      return insertRes.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة العميلة بنجاح',
      customer: newCustomer
    }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('مسجل مسبقاً')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error('Error creating customer:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ بيانات العميلة' }, { status: 500 });
  }
}
