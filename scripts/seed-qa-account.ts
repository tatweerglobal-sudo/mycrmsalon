// scripts/seed-qa-account.ts
// تجهيز حساب فحص واختبار مستقل (QA Test Account) لوكلاء الاختبار الخارجيين مثل TestSprite
// بدون منح أي صلاحيات إدارية للمنصة (Super Admin) وبدون كشف بيانات اتصال قاعدة البيانات

import '../src/lib/load-env';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

export async function seedQaAccount() {
  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required to seed QA account.');
  }

  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  const client = await pool.connect();

  const qaEmail = 'qa-tester@crmsalon.de';
  const qaPassword = process.env.QA_TESTER_PASSWORD || 'QaReviewer#2026!Salon';
  const qaName = 'مختبرة الجودة المعتمدة (QA Reviewer)';

  try {
    console.log('🧪 بدء تجهيز حساب وبيانات الاختبار المستقل (QA Acceptance Testing)...');
    await client.query('BEGIN');

    // 1. العثور على صالون لوتس بيوتي
    const tenantRes = await client.query(`SELECT id FROM tenants WHERE slug = 'lotus-beauty'`);
    if (tenantRes.rows.length === 0) {
      throw new Error('Tenant lotus-beauty not found. Please run bootstrap first.');
    }
    const tenantId = tenantRes.rows[0].id;

    // 2. العثور على الفرع الرئيسي
    const branchRes = await client.query(`SELECT id FROM branches WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const branchId = branchRes.rows[0]?.id || null;

    // 3. التحقق من وجود مستخدم QA
    const userCheck = await client.query(`SELECT id FROM users WHERE email = $1`, [qaEmail]);
    let qaUserId = userCheck.rows[0]?.id;

    if (!qaUserId) {
      const hash = await bcrypt.hash(qaPassword, 12);
      const userRes = await client.query(`
        INSERT INTO users (email, full_name, password_hash, phone_normalized, is_active, is_super_admin)
        VALUES ($1, $2, $3, '+966500000099', true, false)
        RETURNING id;
      `, [qaEmail, qaName, hash]);
      qaUserId = userRes.rows[0].id;
      console.log(`✔ تم إنشاء مستخدم QA جديد: ${qaEmail}`);
    } else {
      console.log(`✔ مستخدم QA موجود مسبقاً (${qaEmail})، الحفاظ على الحساب.`);
    }

    // 4. ربط العضوية كـ salon_manager (مديرة صالون معتمدة للاختبار)
    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'salon_manager', $3, true)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = 'salon_manager', is_active = true, updated_at = NOW();
    `, [tenantId, qaUserId, branchId]);

    // 5. إضافة سجلات تجريبية اصطناعية للعملاء
    const sampleCustomers = [
      { name: 'هند الشمري', phone: '+966551122334' },
      { name: 'روان القحطاني', phone: '+966552233445' },
      { name: 'دانة الدوسري', phone: '+966553344556' },
    ];

    for (const c of sampleCustomers) {
      await client.query(`
        INSERT INTO customers (tenant_id, full_name, phone_normalized)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, phone_normalized) DO NOTHING;
      `, [tenantId, c.name, c.phone]);
    }

    await client.query('COMMIT');
    console.log('✅ تم تجهيز حساب وبيانات الـ QA بنجاح تام.');
    console.log('--------------------------------------------------');
    console.log(`👤 البريد الإلكتروني: ${qaEmail}`);
    console.log(`🔑 كلمة المرور: ${qaPassword}`);
    console.log(`🏷️ الدور: salon_manager (بدون صلاحيات منصة سحابية super admin)`);
    console.log('--------------------------------------------------');

    return {
      email: qaEmail,
      password: qaPassword,
      role: 'salon_manager',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed-qa-account.ts')) {
  seedQaAccount()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ فشل تجهيز حساب الـ QA:', err);
      process.exit(1);
    });
}
