// src/app/api/v1/extension/capture/route.ts
// الواجهة البرمجية لاستقبال والتقاط بيانات العميلات والمواعيد مباشرة من إضافة المتصفح
// تدعم التحقق الحي، منع التكرار، وتطبيق العزل المتعدد للمراكز (Multi-Tenant Capture)

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { getMigrationDbPool } from '@/lib/db';
import { normalizePhone } from '@/lib/phone-normalizer';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  // 1. التحقق من التوكن وهوية المركز
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'غير مصرح به: رمز التوكن غير صالح أو منتهي الصلاحية.' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const {
      phone,
      name,
      job, // الخدمة المطلوبة
      status = 'جديد',
      employee, // الأخصائية أو الموظفة المسؤولة
      tags = [],
      interviewed = false, // تم حجز موعد / تقديم خدمة مسبقة
      followUpDate,
      interviewDate, // موعد الحجز أو الزيارة
      notes,
    } = body;

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json(
        { ok: false, error: 'رقم الهاتف مطلوب لتسجيل العميل/ة.' },
        { status: 422 }
      );
    }

    const pool = getMigrationDbPool();
    const tenantId = session.tenantId;

    // 2. جلب بيانات المركز الحالية للحصول على كود الدولة والفرع الرئيسي
    const tenantRes = await pool.query(
      'SELECT id, country_code, currency FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (tenantRes.rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'مركز التجميل غير موجود أو معطل.' },
        { status: 404 }
      );
    }
    const tenant = tenantRes.rows[0];

    // جلب الفرع الرئيسي للمركز
    const branchRes = await pool.query(
      'SELECT id FROM branches WHERE tenant_id = $1 ORDER BY is_main DESC, created_at ASC LIMIT 1',
      [tenantId]
    );
    const branchId = branchRes.rows[0]?.id;

    // 3. تطبيع رقم الهاتف بصيغة E.164 الدولية
    const norm = normalizePhone(phone.trim(), tenant.country_code as any);
    const phoneNormalized = norm.isValid ? norm.phoneNormalized : phone.trim();
    const clientName = (name && typeof name === 'string' && name.trim()) ? name.trim() : 'عميلة جديدة (واتساب)';

    // تجميع الملاحظات
    const notesParts: string[] = [];
    if (status) notesParts.push(`[الحالة: ${status}]`);
    if (job) notesParts.push(`[الخدمة المطلوبة: ${job}]`);
    if (employee) notesParts.push(`[الموظفة/الأخصائية: ${employee}]`);
    if (Array.isArray(tags) && tags.length > 0) notesParts.push(`[الوسوم: ${tags.join(', ')}]`);
    if (followUpDate) notesParts.push(`[تاريخ المتابعة: ${followUpDate}]`);
    if (notes && typeof notes === 'string' && notes.trim()) notesParts.push(notes.trim());
    const combinedNotes = notesParts.join(' • ');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 4. إدراج أو تحديث العميل/ة في جدول customers داخل نفس المركز (Tenant-Scoped)
      const customerRes = await client.query(
        `INSERT INTO customers (
          tenant_id, full_name, phone_raw, phone_normalized, country_code,
          preferences, notes, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        ON CONFLICT (tenant_id, phone_normalized)
        DO UPDATE SET
          full_name = CASE WHEN customers.full_name = 'عميلة جديدة (واتساب)' THEN EXCLUDED.full_name ELSE customers.full_name END,
          preferences = COALESCE(EXCLUDED.preferences, customers.preferences),
          notes = CASE 
            WHEN customers.notes IS NULL OR customers.notes = '' THEN EXCLUDED.notes
            ELSE customers.notes || E'\n' || EXCLUDED.notes
          END,
          updated_at = NOW()
        RETURNING id, full_name, phone_normalized`,
        [
          tenantId,
          clientName,
          phone.trim(),
          phoneNormalized,
          tenant.country_code,
          job || null,
          combinedNotes,
        ]
      );

      const savedCustomer = customerRes.rows[0];

      // 5. إذا حُدد موعد حجز أو زيارة (interviewDate) أو تم تأكيد الحجز
      let createdAppointmentId: string | null = null;
      if (interviewDate && branchId) {
        const appointmentStart = new Date(interviewDate);
        if (!isNaN(appointmentStart.getTime())) {
          const appointmentEnd = new Date(appointmentStart.getTime() + 45 * 60 * 1000); // 45 دقيقة افتراضياً
          
          const aptRes = await client.query(
            `INSERT INTO appointments (
              tenant_id, branch_id, customer_id, starts_at, ends_at,
              status, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id`,
            [
              tenantId,
              branchId,
              savedCustomer.id,
              appointmentStart.toISOString(),
              appointmentEnd.toISOString(),
              interviewed ? 'completed' : 'booked',
              `حجز من إضافة واتساب • الخدمة: ${job || 'عام'} • الموظفة: ${employee || 'تلقائي'}`,
              session.userId,
            ]
          );
          createdAppointmentId = aptRes.rows[0]?.id || null;
        }
      }

      await client.query('COMMIT');

      return NextResponse.json(
        {
          ok: true,
          status: 201,
          message: 'تم تسجيل العميل/ة وتنسيق البيانات بنجاح في مركزك.',
          data: {
            candidateId: savedCustomer.id,
            customerId: savedCustomer.id,
            customerName: savedCustomer.full_name,
            phone: savedCustomer.phone_normalized,
            service: job,
            appointmentId: createdAppointmentId,
          },
        },
        { status: 201 }
      );
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Extension capture endpoint error:', error);
    return NextResponse.json(
      { ok: false, error: 'حدث خطأ أثناء حفظ بيانات العميل/ة في النظام.' },
      { status: 500 }
    );
  }
}
