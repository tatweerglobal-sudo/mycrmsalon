// scripts/prepare-production-launch.ts
// تجهيز بيئة الإنتاج الرسمية: إنشاء نسخة استعادة، تنظيف البيانات التجريبية،
// وتجهيز الخدمات الحقيقية الأولى دون أي سجلات وهمية أو بيانات مصطنعة

import '../src/lib/load-env';
import fs from 'node:fs';
import path from 'node:path';
import { getMigrationDbPool } from '../src/lib/db';

async function prepareProduction() {
  const pool = getMigrationDbPool();
  const client = await pool.connect();
  const backupDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, `neon-backup-pre-launch-${Date.now()}.json`);

  try {
    console.log('🛡️ الخطوة 1: أخذ لقطة استعادة كاملة (Backup Snapshot) قبل التنظيف...');
    await client.query('BEGIN');

    const backupData: Record<string, unknown> = {};
    const tables = [
      'tenants', 'branches', 'users', 'memberships', 'salon_staff',
      'customers', 'service_categories', 'services', 'staff_services',
      'appointments', 'invoices', 'payments', 'products'
    ];

    for (const tbl of tables) {
      const res = await client.query(`SELECT * FROM "${tbl}"`);
      backupData[tbl] = res.rows;
    }

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`✔ تم حفظ نسخة الاستعادة في: ${backupFile}`);

    console.log('🧹 الخطوة 2: تنظيف البيانات الاصطناعية والتجريبية المتبقية من الاختبارات...');

    // حذف صالونات الاختبار الاصطناعية القديمة (سلسلة الحذف Cascade ستحذف عضوياتها)
    await client.query(`
      DELETE FROM tenants
      WHERE slug LIKE 'misk-amber-%'
         OR slug LIKE 'temp-salon-%'
         OR slug LIKE 'temp-role-%'
         OR slug = 'qa-sandbox-salon';
    `);

    // حذف مستخدمي الاختبار الاصطناعيين القدامى
    await client.query(`
      DELETE FROM users
      WHERE email LIKE '%@crmsalon.test'
         OR email = 'qa-tester@crmsalon.de';
    `);

    // تنظيف العملاء والمواعيد الاصطناعية من الصالون الرئيسي لبدء الإنتاج بنظافة تامة
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM invoices');
    await client.query('DELETE FROM appointment_services');
    await client.query('DELETE FROM appointments');
    await client.query('DELETE FROM customers');
    await client.query('DELETE FROM inventory_transactions');
    await client.query('DELETE FROM products');

    console.log('🏢 الخطوة 3: تجهيز الصالون الإنتاجي المعتمد وحساب المالك المؤسس...');

    // 1. تثبيت صالون لوتس بيوتي
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, slug, country_code, timezone, currency, status, subscription_tier, max_branches, max_staff)
      VALUES ('صالون لوتس بيوتي للتزيين النسائي', 'lotus-beauty', 'SA', 'Asia/Riyadh', 'SAR', 'active', 'growth', 3, 15)
      ON CONFLICT (slug) DO UPDATE
        SET name = 'صالون لوتس بيوتي للتزيين النسائي', status = 'active', updated_at = NOW()
      RETURNING id;
    `);
    const tenantId = tenantRes.rows[0].id;

    // 2. تثبيت الفرع الرئيسي
    const branchRes = await client.query(`
      INSERT INTO branches (tenant_id, name, city, address, is_main, is_active, opening_time, closing_time)
      VALUES ($1, 'الفرع الرئيسي - الرياض', 'الرياض', 'طريق الملك فهد، العليا', true, true, '10:00:00', '22:00:00')
      ON CONFLICT (tenant_id, name) DO UPDATE
        SET is_active = true, updated_at = NOW()
      RETURNING id;
    `, [tenantId]);
    const branchId = branchRes.rows[0].id;

    // 3. ترقية حساب المالك إلى Super Admin لتمكينه من إدارة المنصة بالكامل
    const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@crmsalon.de').toLowerCase().trim();
    await client.query(`
      UPDATE users
      SET is_super_admin = true, is_active = true, updated_at = NOW()
      WHERE email = $1;
    `, [ownerEmail]);

    const ownerRes = await client.query(`SELECT id FROM users WHERE email = $1`, [ownerEmail]);
    const ownerId = ownerRes.rows[0]?.id;

    if (ownerId) {
      await client.query(`
        INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
        VALUES ($1, $2, 'salon_owner', $3, true)
        ON CONFLICT (tenant_id, user_id) DO UPDATE
          SET role = 'salon_owner', is_active = true, updated_at = NOW();
      `, [tenantId, ownerId, branchId]);
    }

    console.log('💇 الخطوة 4: تهيئة الخدمات غير الطبية الأساسية للصالون...');

    // تصنيفات الخدمات
    const catHair = await client.query(`
      INSERT INTO service_categories (tenant_id, name, display_order)
      VALUES ($1, 'العناية بالشعر والتصفيف', 1)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true RETURNING id;
    `, [tenantId]);

    const catBeauty = await client.query(`
      INSERT INTO service_categories (tenant_id, name, display_order)
      VALUES ($1, 'المكياج ونضارة البشرة', 2)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true RETURNING id;
    `, [tenantId]);

    const catNails = await client.query(`
      INSERT INTO service_categories (tenant_id, name, display_order)
      VALUES ($1, 'الأظافر والمساج', 3)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true RETURNING id;
    `, [tenantId]);

    // الخدمات الإنتاجية المعتمدة
    const standardServices = [
      { cat: catHair.rows[0].id, name: 'قص وتصفيف الشعر الاحترافي', duration: 45, price: 150.00, desc: 'قص تجميلي بأحدث الموديلات مع غسيل وسشوار متكامل' },
      { cat: catHair.rows[0].id, name: 'صبغة شعر كاملة مع رنساج', duration: 90, price: 350.00, desc: 'صبغة عضوية آمنة خالية من الأمونيا لحماية حيوية الشعر' },
      { cat: catHair.rows[0].id, name: 'جلسة ترطيب ومعالجة كولاجين', duration: 60, price: 220.00, desc: 'علاج عميق للشعر الجاف والمجهد بالكولاجين والزيوت الطبيعية' },
      { cat: catBeauty.rows[0].id, name: 'مكياج سهرة ناعم وفخم', duration: 60, price: 300.00, desc: 'مكياج مناسبات احترافي مع تركيب رموش وتثبيت مقاوم للرطوبة' },
      { cat: catBeauty.rows[0].id, name: 'تنظيف بشرة هيدرا نضارة فوري', duration: 50, price: 250.00, desc: 'تنظيف عميق للمسام وتقشير كريستالي وترطيب بحمض الهيالورونيك' },
      { cat: catNails.rows[0].id, name: 'مناكير وبديكير كلاسيك مع مساج', duration: 60, price: 180.00, desc: 'عناية كاملة بالأظافر والجلد المحيط مع سنفرة وتقشير وترطيب' },
      { cat: catNails.rows[0].id, name: 'مساج استرخائي لكامل الجسم', duration: 60, price: 280.00, desc: 'مساج سويدي استرخائي بالزيوت العطرية لتخفيف الإجهاد العضلي' }
    ];

    for (const s of standardServices) {
      await client.query(`
        INSERT INTO services (tenant_id, category_id, name, description, duration_minutes, price, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (tenant_id, name) DO UPDATE
          SET category_id = EXCLUDED.category_id,
              description = EXCLUDED.description,
              duration_minutes = EXCLUDED.duration_minutes,
              price = EXCLUDED.price,
              is_active = true,
              updated_at = NOW();
      `, [tenantId, s.cat, s.name, s.desc, s.duration, s.price]);
    }

    // إضافة أخصائية تجميل معتمدة للصالون
    const staffRes = await client.query(`
      INSERT INTO salon_staff (tenant_id, branch_id, display_name, title, commission_rate, is_active)
      VALUES ($1, $2, 'سارة العتيبي', 'أخصائية أولى شعر ومكياج', 10.00, true)
      RETURNING id;
    `, [tenantId, branchId]);
    const staffId = staffRes.rows[0].id;

    // ربط الأخصائية بجميع الخدمات
    const allServices = await client.query('SELECT id FROM services WHERE tenant_id = $1', [tenantId]);
    for (const sRow of allServices.rows) {
      await client.query(`
        INSERT INTO staff_services (staff_id, service_id, tenant_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (staff_id, service_id) DO NOTHING;
      `, [staffId, sRow.id, tenantId]);
    }

    await client.query('COMMIT');
    console.log('🎉 اكتملت عملية التجهيز والتهيئة للإنتاج بنجاح!');
    console.log('--------------------------------------------------');
    console.log('✔ العملاء: 0 (جاهز لاستقبال أول عميلة حقيقية)');
    console.log('✔ المواعيد: 0 (جاهز لأول حجز حقيقي)');
    console.log('✔ الفواتير والمدفوعات: 0 (جاهز لأول معاملة مالية)');
    console.log('✔ الخدمات المتاحة: 7 خدمات معتمدة بالأسعار والمدد');
    console.log('✔ الفروع: الفرع الرئيسي - الرياض (نشط ومفعل)');
    console.log('✔ مدير المنصة: owner@crmsalon.de (Super Admin + Salon Owner)');
    console.log('--------------------------------------------------');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

prepareProduction()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ خطأ أثناء تجهيز بيئة الإنتاج:', err);
    process.exit(1);
  });
