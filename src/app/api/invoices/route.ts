// src/app/api/invoices/route.ts
// الواجهة البرمجية لإدارة الفواتير والتحصيل المالي (Invoices API)

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

// 1. استعراض الفواتير
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status')?.trim();
  const customerId = searchParams.get('customerId')?.trim();

  try {
    const pool = getDbPool();
    const invoices = await withTenantDb(pool, session, async (client) => {
      let query = `
        SELECT i.id, i.invoice_number, i.subtotal, i.discount_amount,
               i.tax_amount, i.total_amount, i.paid_amount, i.status,
               i.notes, i.created_at,
               c.id as customer_id, c.full_name as customer_name, c.phone_normalized as customer_phone,
               b.id as branch_id, b.name as branch_name,
               a.id as appointment_id, a.starts_at as appointment_time
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        JOIN branches b ON i.branch_id = b.id
        LEFT JOIN appointments a ON i.appointment_id = a.id
        WHERE 1=1
      `;
      const params: unknown[] = [];
      let idx = 1;

      if (status) {
        query += ` AND i.status = $${idx++}`;
        params.push(status);
      }
      if (customerId) {
        query += ` AND i.customer_id = $${idx++}`;
        params.push(customerId);
      }

      query += ` ORDER BY i.created_at DESC LIMIT 150`;

      const res = await client.query(query, params);
      return res.rows;
    });

    return NextResponse.json({ success: true, invoices });
  } catch (err: unknown) {
    console.error('Error fetching invoices:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب الفواتير' }, { status: 500 });
  }
}

// 2. إصدار فاتورة جديدة
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
    const { customerId, branchId, appointmentId, subtotal, discountAmount, notes } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'العميلة مطلوبة لإصدار الفاتورة' }, { status: 400 });
    }

    const sub = Number(subtotal);
    if (isNaN(sub) || sub < 0) {
      return NextResponse.json({ error: 'المبلغ الإجمالي الأولي غير صحيح' }, { status: 400 });
    }

    const disc = Number(discountAmount || 0);
    if (isNaN(disc) || disc < 0 || disc > sub) {
      return NextResponse.json({ error: 'قيمة الخصم غير صحيحة' }, { status: 400 });
    }

    const taxableAmount = Math.max(0, sub - disc);
    const tax = Math.round(taxableAmount * 0.15 * 100) / 100; // 15% ضريبة القيمة المضافة
    const total = Math.round((taxableAmount + tax) * 100) / 100;

    const pool = getDbPool();
    const invoice = await withTenantDb(pool, session, async (client, ctx) => {
      // التحقق من الفرع
      let resolvedBranchId = branchId;
      if (!resolvedBranchId) {
        const branchRes = await client.query('SELECT id FROM branches WHERE is_main = true LIMIT 1');
        resolvedBranchId = branchRes.rows[0]?.id;
        if (!resolvedBranchId) {
          const anyBranch = await client.query('SELECT id FROM branches LIMIT 1');
          resolvedBranchId = anyBranch.rows[0]?.id;
        }
      }
      if (!resolvedBranchId) {
        throw new Error('لا يوجد فرع محدد لإصدار الفاتورة');
      }

      // توليد رقم فاتورة فريد
      const countRes = await client.query('SELECT COUNT(*) as cnt FROM invoices');
      const invoiceSeq = (parseInt(countRes.rows[0].cnt, 10) + 1).toString().padStart(5, '0');
      const year = new Date().getFullYear();
      const invoiceNumber = `INV-${year}-${invoiceSeq}`;

      const res = await client.query(`
        INSERT INTO invoices (
          tenant_id, branch_id, customer_id, appointment_id, invoice_number,
          subtotal, discount_amount, tax_amount, total_amount, paid_amount,
          status, notes
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, 0.00,
          'unpaid', $10
        ) RETURNING id, invoice_number, subtotal, discount_amount, tax_amount, total_amount, paid_amount, status, created_at;
      `, [
        ctx.tenantId,
        resolvedBranchId,
        customerId,
        appointmentId || null,
        invoiceNumber,
        sub,
        disc,
        tax,
        total,
        notes?.trim() || null
      ]);

      return res.rows[0];
    });

    return NextResponse.json({
      success: true,
      message: 'تم إصدار الفاتورة بنجاح',
      invoice,
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('Error creating invoice:', err);
    return NextResponse.json({ error: (err as Error).message || 'حدث خطأ أثناء إصدار الفاتورة' }, { status: 500 });
  }
}
