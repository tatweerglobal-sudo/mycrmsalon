// src/app/api/appointments/route.ts
// الواجهة البرمجية لحجز وإدارة المواعيد مع الكشف الذكي عن التعارض الزمني (Conflict Detection)

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

// 1. استعراض المواعيد والحجوزات
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status')?.trim();
  const staffId = searchParams.get('staffId')?.trim();
  const customerId = searchParams.get('customerId')?.trim();

  try {
    const pool = getDbPool();
    const appointments = await withTenantDb(pool, session, async (client) => {
      let query = `
        SELECT a.id, a.starts_at, a.ends_at, a.status, a.total_price,
               a.discount_amount, a.final_price, a.payment_status, a.notes,
               a.created_at,
               c.id as customer_id, c.full_name as customer_name, c.phone_normalized as customer_phone,
               s.id as staff_id, s.display_name as staff_name,
               b.id as branch_id, b.name as branch_name
        FROM appointments a
        JOIN customers c ON a.customer_id = c.id
        LEFT JOIN salon_staff s ON a.staff_id = s.id
        LEFT JOIN branches b ON a.branch_id = b.id
        WHERE 1=1
      `;
      const params: unknown[] = [];
      let idx = 1;

      if (status) {
        query += ` AND a.status = $${idx++}`;
        params.push(status);
      }
      if (staffId) {
        query += ` AND a.staff_id = $${idx++}`;
        params.push(staffId);
      }
      if (customerId) {
        query += ` AND a.customer_id = $${idx++}`;
        params.push(customerId);
      }

      query += ` ORDER BY a.starts_at DESC LIMIT 150`;

      const res = await client.query(query, params);
      return res.rows;
    });

    return NextResponse.json({ success: true, appointments });
  } catch (err: unknown) {
    console.error('Error fetching appointments:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب المواعيد' }, { status: 500 });
  }
}

// 2. إنشاء حجز جديد مع منع التعارض التام (No Double-Booking)
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
    const { customerId, serviceId, staffId, startsAt, notes } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'العميلة مطلوبة لإنشاء الحجز' }, { status: 400 });
    }
    if (!serviceId) {
      return NextResponse.json({ error: 'الخدمة مطلوبة لإنشاء الحجز' }, { status: 400 });
    }
    if (!startsAt) {
      return NextResponse.json({ error: 'وقت وتاريخ الموعد مطلوب' }, { status: 400 });
    }

    const startDate = new Date(startsAt);
    if (isNaN(startDate.getTime())) {
      return NextResponse.json({ error: 'تاريخ الموعد غير صحيح' }, { status: 400 });
    }

    const pool = getDbPool();
    const appointment = await withTenantDb(pool, session, async (client, ctx) => {
      // 1. جلب تفاصيل وسعر ومدة الخدمة
      const srvRes = await client.query(
        'SELECT id, name, duration_minutes, price FROM services WHERE id = $1 AND is_active = true',
        [serviceId]
      );
      if (srvRes.rows.length === 0) {
        throw new Error('الخدمة المحددة غير موجودة أو غير مفعلة');
      }
      const service = srvRes.rows[0];

      // حساب وقت نهاية الحجز
      const endDate = new Date(startDate.getTime() + service.duration_minutes * 60000);

      // 2. جلب الفرع الرئيسي
      const branchRes = await client.query('SELECT id FROM branches WHERE is_main = true LIMIT 1');
      const branchId = branchRes.rows[0]?.id;
      if (!branchId) {
        throw new Error('لا يوجد فرع نشط في الصالون');
      }

      // 3. فحص التعارض الزمني إذا تم تحديد موظفة (Staff Double-Booking Prevention)
      if (staffId) {
        const conflictCheck = await client.query(`
          SELECT id, starts_at, ends_at FROM appointments
          WHERE staff_id = $1
            AND status IN ('booked', 'confirmed', 'in_progress')
            AND starts_at < $2
            AND ends_at > $3
          LIMIT 1;
        `, [staffId, endDate.toISOString(), startDate.toISOString()]);

        if (conflictCheck.rows.length > 0) {
          throw new Error('تعارض زمني: الموظفة المختارة لديها حجز آخر متداخل في هذا التوقيت.');
        }
      }

      // 4. إنشاء الحجز
      const aptRes = await client.query(`
        INSERT INTO appointments (
          tenant_id, branch_id, customer_id, staff_id, starts_at, ends_at,
          status, total_price, discount_amount, final_price, payment_status,
          notes, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          'booked', $7, 0.00, $7, 'unpaid',
          $8, $9
        ) RETURNING id, starts_at, ends_at, status, final_price, created_at;
      `, [
        ctx.tenantId,
        branchId,
        customerId,
        staffId || null,
        startDate.toISOString(),
        endDate.toISOString(),
        service.price,
        notes?.trim() || null,
        ctx.userId
      ]);

      const createdApt = aptRes.rows[0];

      // 5. ربط تفاصيل الخدمة بالحجز
      await client.query(`
        INSERT INTO appointment_services (
          appointment_id, service_id, tenant_id, staff_id, price, duration_minutes
        ) VALUES (
          $1, $2, $3, $4, $5, $6
        );
      `, [
        createdApt.id,
        service.id,
        ctx.tenantId,
        staffId || null,
        service.price,
        service.duration_minutes
      ]);

      return createdApt;
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسجيل الحجز بنجاح دون أي تعارض زمني',
      appointment,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('تعارض زمني')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error('Error booking appointment:', err);
    return NextResponse.json({ error: message || 'حدث خطأ أثناء حفظ الحجز' }, { status: 500 });
  }
}

// 3. تحديث حالة الحجز (تأكيد، إتمام، إلغاء)
export async function PATCH(req: NextRequest) {
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
    const { appointmentId, status, cancellationReason } = body;

    const validStatuses = ['booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
    if (!appointmentId || !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'معرف الحجز وحالة صالحة مطلوبان' }, { status: 400 });
    }

    const pool = getDbPool();
    const updated = await withTenantDb(pool, session, async (client) => {
      let query = `
        UPDATE appointments
        SET status = $1, updated_at = NOW()
      `;
      const params: unknown[] = [status];

      if (status === 'cancelled') {
        query += `, cancelled_at = NOW(), cancellation_reason = $2 WHERE id = $3`;
        params.push(cancellationReason?.trim() || 'إلغاء بناء على طلب العميل', appointmentId);
      } else {
        query += ` WHERE id = $2`;
        params.push(appointmentId);
      }

      query += ` RETURNING id, status, updated_at;`;

      const res = await client.query(query, params);
      if (res.rows.length === 0) {
        throw new Error('الحجز غير موجود أو لا تملك صلاحية تعديله');
      }
      return res.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تم تحديث حالة الحجز بنجاح',
      appointment: updated
    });
  } catch (err: unknown) {
    console.error('Error updating appointment:', err);
    return NextResponse.json({ error: (err as Error).message || 'حدث خطأ أثناء تعديل الحجز' }, { status: 500 });
  }
}
