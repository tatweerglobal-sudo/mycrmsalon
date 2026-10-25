// src/app/api/dashboard/stats/route.ts
// الواجهة البرمجية للمؤشرات الحية للوحة التحكم (Dashboard KPIs API)
// يجلب البيانات الفعلية والمحسوبة لحظياً من قاعدة بيانات Neon مع عزل RLS التام

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken } from '@/lib/auth/session';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

function getSessionFromRequest(req: NextRequest) {
  const cookie = req.cookies.get('salon_session')?.value;
  if (!cookie) return null;
  return verifySessionToken(cookie);
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  try {
    const pool = getDbPool();
    const stats = await withTenantDb(pool, session, async (client) => {
      // 1. إجمالي العملاء
      const custRes = await client.query('SELECT COUNT(*) as count FROM customers WHERE is_active = true');
      const totalCustomers = parseInt(custRes.rows[0].count, 10);

      // 2. مواعيد اليوم
      const todayRes = await client.query(`
        SELECT COUNT(*) as count
        FROM appointments
        WHERE starts_at::date = CURRENT_DATE
          AND status != 'cancelled'
      `);
      const todayAppointments = parseInt(todayRes.rows[0].count, 10);

      // 3. إجمالي المواعيد
      const totalAptRes = await client.query('SELECT COUNT(*) as count FROM appointments');
      const totalAppointments = parseInt(totalAptRes.rows[0].count, 10);

      // 4. إجمالي الإيرادات المحصلة
      const revRes = await client.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments');
      const totalRevenue = parseFloat(revRes.rows[0].total);

      // 5. عدد الخدمات والموظفات
      const srvRes = await client.query('SELECT COUNT(*) as count FROM services WHERE is_active = true');
      const activeServices = parseInt(srvRes.rows[0].count, 10);

      const stfRes = await client.query('SELECT COUNT(*) as count FROM salon_staff WHERE is_active = true');
      const activeStaff = parseInt(stfRes.rows[0].count, 10);

      // 6. المنتجات المنخفضة المخزون
      const lowStockRes = await client.query('SELECT COUNT(*) as count FROM products WHERE is_active = true AND quantity <= min_quantity');
      const lowStockCount = parseInt(lowStockRes.rows[0].count, 10);

      // 7. آخر 5 مواعيد
      const recentAptRes = await client.query(`
        SELECT a.id, a.starts_at, a.status, a.final_price,
               c.full_name as customer_name,
               s.display_name as staff_name
        FROM appointments a
        JOIN customers c ON a.customer_id = c.id
        LEFT JOIN salon_staff s ON a.staff_id = s.id
        ORDER BY a.starts_at DESC
        LIMIT 5
      `);

      // 8. آخر 5 فواتير
      const recentInvRes = await client.query(`
        SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount, i.status, i.created_at,
               c.full_name as customer_name
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        ORDER BY i.created_at DESC
        LIMIT 5
      `);

      return {
        totalCustomers,
        todayAppointments,
        totalAppointments,
        totalRevenue,
        activeServices,
        activeStaff,
        lowStockCount,
        recentAppointments: recentAptRes.rows,
        recentInvoices: recentInvRes.rows,
      };
    });

    return NextResponse.json({ success: true, stats });
  } catch (err: unknown) {
    console.error('Error fetching dashboard stats:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب مؤشرات لوحة التحكم' }, { status: 500 });
  }
}
