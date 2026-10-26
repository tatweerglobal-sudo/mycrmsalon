// src/app/api/services/route.ts
// الواجهة البرمجية لإدارة خدمات وباقات مركز التجميل (Services API)
// مع التحقق الحي من الجلسة في Neon وفرض صلاحية services:manage

import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض الخدمات والتصنيفات
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const data = await withTenantDb(auth.pool, auth.session, async (client) => {
      // جلب التصنيفات
      const categoriesRes = await client.query(`
        SELECT id, name, display_order
        FROM service_categories
        WHERE is_active = true
        ORDER BY display_order ASC, name ASC
      `);

      // جلب الخدمات
      const servicesRes = await client.query(`
        SELECT s.id, s.name, s.description, s.duration_minutes, s.buffer_minutes,
               s.price, s.is_package, s.is_active, s.category_id,
               c.name as category_name
        FROM services s
        LEFT JOIN service_categories c ON s.category_id = c.id
        WHERE s.is_active = true
        ORDER BY c.display_order ASC NULLS LAST, s.name ASC
      `);

      return {
        categories: categoriesRes.rows,
        services: servicesRes.rows,
      };
    });

    return NextResponse.json({ success: true, ...data });
  } catch (err: unknown) {
    console.error('Error fetching services:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة الخدمات' }, { status: 500 });
  }
}

// 2. إضافة خدمة جديدة
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { permission: 'services:manage' });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { name, categoryId, durationMinutes, price, description, isPackage } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'اسم الخدمة مطلوب ويجب ألا يقل عن حرفين' }, { status: 400 });
    }

    const duration = Number(durationMinutes);
    if (isNaN(duration) || duration <= 0) {
      return NextResponse.json({ error: 'مدة الخدمة بالدقائق يجب أن تكون رقماً أكبر من صفر' }, { status: 400 });
    }

    const cost = Number(price);
    if (isNaN(cost) || cost < 0) {
      return NextResponse.json({ error: 'سعر الخدمة يجب أن يكون رقماً صحيحاً موجباً' }, { status: 400 });
    }

    const newService = await withTenantDb(auth.pool, auth.session, async (client, ctx) => {
      // فحص عدم تكرار الاسم في نفس الصالون
      const dup = await client.query('SELECT id FROM services WHERE name = $1 LIMIT 1', [name.trim()]);
      if (dup.rows.length > 0) {
        throw new Error('توجد خدمة بنفس هذا الاسم مسجلة مسبقاً في الصالون');
      }

      const res = await client.query(`
        INSERT INTO services (
          tenant_id, category_id, name, description, duration_minutes, price, is_package, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, true
        ) RETURNING id, name, price, duration_minutes, created_at;
      `, [
        ctx.tenantId,
        categoryId || null,
        name.trim(),
        description?.trim() || null,
        duration,
        cost,
        Boolean(isPackage)
      ]);

      return res.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة الخدمة بنجاح',
      service: newService,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('مسجلة مسبقاً')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error('Error creating service:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ الخدمة' }, { status: 500 });
  }
}
