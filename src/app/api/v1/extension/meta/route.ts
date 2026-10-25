// src/app/api/v1/extension/meta/route.ts
// الواجهة البرمجية لتزويد إضافة المتصفح بقوائم الخدمات، الأخصائيات، الحالات، والوسوم المعتمدة
// تعمل تحت العزل التام للمستأجر (Tenant-Isolated Metadata)

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { getMigrationDbPool } from '@/lib/db';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function GET(req: NextRequest) {
  if (process.env.NEXT_OUTPUT_EXPORT === 'true') {
    return NextResponse.json({ error: 'غير مفعل في نسخة المعاينة الثابتة' }, { status: 400 });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'غير مصرح به: رمز الدخول (Bearer Token) مفقود أو غير صالح.' },
      { status: 401 }
    );
  }

  try {
    const pool = getMigrationDbPool();
    const tenantId = session.tenantId;

    // 1. جلب الخدمات المعتمدة من جدول services
    const servicesRes = await pool.query(
      `SELECT s.id, s.name as title, COALESCE(sc.name, 'عام') as department, s.price, s.duration_minutes
       FROM services s
       LEFT JOIN service_categories sc ON sc.id = s.category_id AND sc.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.is_active = true
       ORDER BY sc.display_order ASC NULLS LAST, s.name ASC`,
      [tenantId]
    );

    let jobs = servicesRes.rows;
    // إذا لم تكن هناك خدمات مدخلة بعد لهذا المركز، نوفر قائمة خدمات أساسية افتراضية
    if (jobs.length === 0) {
      jobs = [
        { id: 'srv-hair-1', title: 'قص وسشوار شعر', department: 'الشعر والتصفيف' },
        { id: 'srv-hair-2', title: 'صبغة وتفتيح شعر', department: 'الشعر والتصفيف' },
        { id: 'srv-hair-3', title: 'علاج بروتين وكيراتين', department: 'معالجات الشعر' },
        { id: 'srv-skin-1', title: 'تنظيف بشرة هيدرافيشل', department: 'العناية بالبشرة' },
        { id: 'srv-skin-2', title: 'جلسة نضارة وتقشير', department: 'العناية بالبشرة' },
        { id: 'srv-makeup-1', title: 'مكياج سهرة VIP', department: 'المكياج' },
        { id: 'srv-makeup-2', title: 'باقة تجهيز عروس كاملة', department: 'المكياج' },
        { id: 'srv-nails-1', title: 'بديكير ومناكير سبا', department: 'الأظافر' },
        { id: 'srv-nails-2', title: 'تركيب أظافر جل وأكريليك', department: 'الأظافر' },
        { id: 'srv-spa-1', title: 'حمام مغربي ملكي بالأعشاب', department: 'السبا والمساج' },
        { id: 'srv-spa-2', title: 'جلسة تدليك ومساج استرخائي', department: 'السبا والمساج' },
      ];
    }

    // 2. جلب الأخصائيات والموظفات من جدول salon_staff أو memberships
    const staffRes = await pool.query(
      `SELECT id, display_name as "displayName", COALESCE(title, 'أخصائية تجميل') as role
       FROM salon_staff
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY display_name ASC`,
      [tenantId]
    );

    let employees = staffRes.rows;
    if (employees.length === 0) {
      // البحث في المستخدمين المرتبطين بالمركز
      const membersRes = await pool.query(
        `SELECT u.id, u.full_name as "displayName", m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 AND m.is_active = true
         ORDER BY u.full_name ASC`,
        [tenantId]
      );
      employees = membersRes.rows;
    }

    // 3. حالات العملاء الخاصة بمراكز التجميل
    const statuses = [
      { code: 'جديد', label_ar: 'جديدة (طلب أول مرة)', is_default: true },
      { code: 'تم التواصل', label_ar: 'تم التواصل واتساب' },
      { code: 'حجزت موعد', label_ar: 'تم تأكيد حجز الموعد' },
      { code: 'استفسار عن باقة/سعر', label_ar: 'استفسار عن باقة أو عرض' },
      { code: 'عميلة سابقة', label_ar: 'عميلة سابقة / معاودة اتصال' },
      { code: 'عميلة VIP', label_ar: 'عميلة VIP مميزة' },
      { code: 'مؤجل', label_ar: 'مؤجل لاحقاً' },
      { code: 'لم ترد', label_ar: 'لم ترد على المحادثة' },
      { code: 'اعتذرت عن الحجز', label_ar: 'اعتذرت عن الحجز' },
    ];

    // 4. وسوم تصنيف وتفضيلات العميلات
    const tags = [
      { id: 'tag-1', name: 'عناية بالشعر', category: 'خدمات' },
      { id: 'tag-2', name: 'صبغات وتساريح', category: 'خدمات' },
      { id: 'tag-3', name: 'عناية بالبشرة', category: 'خدمات' },
      { id: 'tag-4', name: 'أظافر وبديكير', category: 'خدمات' },
      { id: 'tag-5', name: 'حمام مغربي وسبا', category: 'خدمات' },
      { id: 'tag-6', name: 'باقة عروس VIP', category: 'عروض' },
      { id: 'tag-7', name: 'جلسة رتوش مجانية', category: 'متابعة' },
      { id: 'tag-8', name: 'مهتمة بالعروض الشهرية', category: 'تسويق' },
    ];

    // 5. رقم إصدار البيانات لدعم التحقق الفوري (ETag / 304 Not Modified)
    const version = Buffer.from(
      `${tenantId}-${jobs.length}-${employees.length}-${Date.now().toString().slice(0, 7)}`
    ).toString('base64url');

    return NextResponse.json(
      {
        ok: true,
        data: {
          jobs,
          statuses,
          employees,
          tags,
          currentEmployee: {
            id: session.userId,
            displayName: session.fullName,
          },
          version,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-cache, must-revalidate',
          ETag: `W/"meta-${version}"`,
        },
      }
    );
  } catch (error) {
    console.error('Extension meta endpoint error:', error);
    return NextResponse.json(
      { ok: false, error: 'حدث خطأ أثناء جلب قوائم الصالون المعتمدة.' },
      { status: 500 }
    );
  }
}
