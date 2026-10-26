// src/app/api/payments/route.ts
// الواجهة البرمجية لتسجيل المدفوعات والتحصيل المالي (Payments API)
// مع التحقق الحي من الجلسة في Neon وفرض صلاحيات RBAC

import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

// 1. استعراض المدفوعات
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { permission: 'financials:view' });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get('invoiceId')?.trim();

  try {
    const payments = await withTenantDb(auth.pool, auth.session, async (client) => {
      let query = `
        SELECT p.id, p.amount, p.payment_method, p.reference_number, p.notes, p.created_at,
               i.invoice_number, i.total_amount, i.paid_amount, i.status as invoice_status,
               c.full_name as customer_name
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        JOIN customers c ON i.customer_id = c.id
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (invoiceId) {
        query += ` AND p.invoice_id = $1`;
        params.push(invoiceId);
      }

      query += ` ORDER BY p.created_at DESC LIMIT 150`;

      const res = await client.query(query, params);
      return res.rows;
    });

    return NextResponse.json({ success: true, payments });
  } catch (err: unknown) {
    console.error('Error fetching payments:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب قائمة المدفوعات' }, { status: 500 });
  }
}

// 2. تسجيل دفعة مالية جديدة وتحديث الفاتورة والحجز
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { permission: 'invoices:manage' });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { invoiceId, amount, paymentMethod, referenceNumber, notes } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: 'معرف الفاتورة مطلوب' }, { status: 400 });
    }

    const payAmount = Number(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return NextResponse.json({ error: 'مبلغ الدفعة يجب أن يكون رقماً أكبر من صفر' }, { status: 400 });
    }

    const validMethods = ['cash', 'card', 'bank_transfer', 'pos', 'other'];
    const method = validMethods.includes(paymentMethod) ? paymentMethod : 'cash';

    const result = await withTenantDb(auth.pool, auth.session, async (client, ctx) => {
      // 1. جلب بيانات الفاتورة
      const invRes = await client.query(
        'SELECT id, customer_id, appointment_id, total_amount, paid_amount, status FROM invoices WHERE id = $1',
        [invoiceId]
      );
      if (invRes.rows.length === 0) {
        throw new Error('الفاتورة غير موجودة');
      }

      const inv = invRes.rows[0];
      const currentTotal = Number(inv.total_amount);
      const currentPaid = Number(inv.paid_amount);
      const remaining = Math.max(0, currentTotal - currentPaid);

      if (remaining <= 0) {
        throw new Error('تم سداد هذه الفاتورة بالكامل مسبقاً');
      }

      if (payAmount > remaining + 0.01) {
        throw new Error(`مبلغ الدفعة (${payAmount}) يتجاوز المبلغ المتبقي على الفاتورة (${remaining})`);
      }

      // 2. تسجيل الدفعة
      const payRes = await client.query(`
        INSERT INTO payments (
          tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        ) RETURNING id, amount, payment_method, reference_number, created_at;
      `, [
        ctx.tenantId,
        inv.id,
        payAmount,
        method,
        referenceNumber?.trim() || null,
        notes?.trim() || null,
        ctx.userId
      ]);

      const payment = payRes.rows[0];

      // 3. تحديث المدفوع وحالة الفاتورة
      const newPaid = Math.round((currentPaid + payAmount) * 100) / 100;
      const newStatus = newPaid >= currentTotal - 0.01 ? 'paid' : 'partially_paid';

      await client.query(
        'UPDATE invoices SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3',
        [newPaid, newStatus, inv.id]
      );

      // 4. إذا كانت الفاتورة مرتبطة بحجز، تحديث حالة دفع الحجز
      if (inv.appointment_id) {
        const aptPayStatus = newStatus === 'paid' ? 'paid' : 'partially_paid';
        await client.query(
          'UPDATE appointments SET payment_status = $1, updated_at = NOW() WHERE id = $2',
          [aptPayStatus, inv.appointment_id]
        );
      }

      // 5. زيادة إجمالي إنفاق العميلة
      await client.query(
        'UPDATE customers SET total_spent = total_spent + $1, updated_at = NOW() WHERE id = $2',
        [payAmount, inv.customer_id]
      );

      return {
        payment,
        invoice: {
          id: inv.id,
          totalAmount: currentTotal,
          paidAmount: newPaid,
          status: newStatus,
        }
      };
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسجيل الدفعة وتحديث الفاتورة بنجاح',
      data: result,
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('Error recording payment:', err);
    return NextResponse.json({ error: (err as Error).message || 'حدث خطأ أثناء تسجيل الدفعة' }, { status: 500 });
  }
}
