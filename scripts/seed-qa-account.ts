// scripts/seed-qa-account.ts
// تجهيز وتأمين حساب فحص الجودة المستقل (QA Sandbox Account)
// معزول تماماً في صالون تجارب مستقل دون أي وصول لصالون اللوتس وبدون كشف كلمات المرور

import '../src/lib/load-env';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

export async function seedQaAccount() {
  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required to seed and secure QA account.');
  }

  const qaPassword = process.env.QA_TESTER_PASSWORD;
  if (!qaPassword || qaPassword.trim().length < 12) {
    throw new Error('QA_TESTER_PASSWORD environment variable must be explicitly configured with at least 12 characters.');
  }

  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  const client = await pool.connect();

  const qaEmail = 'qa-tester@crmsalon.de';
  const qaName = 'مختبرة الجودة المعتمدة (QA Reviewer)';
  const sandboxSlug = 'qa-sandbox-salon';
  const sandboxName = 'صالون الاختبارات والتجارب المستقل (QA Sandbox)';

  try {
    console.log('🔒 بدء تأمين حساب الفحص وتدوير كلمة المرور وإنشاء صالون الاختبار المعزول...');
    await client.query('BEGIN');

    // 1. إنشاء مركز تجارب مستقل تماماً عن صالون اللوتس (Isolated QA Sandbox Tenant)
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, slug, country_code, timezone, currency, status, subscription_tier, max_branches, max_staff)
      VALUES ($1, $2, 'SA', 'Asia/Riyadh', 'SAR', 'active', 'growth', 2, 10)
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, status = 'active', updated_at = NOW()
      RETURNING id;
    `, [sandboxName, sandboxSlug]);
    const sandboxTenantId = tenantRes.rows[0].id;

    // 2. إنشاء فرع تجارب مستقل
    const branchRes = await client.query(`
      INSERT INTO branches (tenant_id, name, city, is_main, is_active)
      VALUES ($1, 'فرع تجارب الجودة المستقل', 'الرياض', true, true)
      ON CONFLICT (tenant_id, name) DO UPDATE
        SET is_active = true, updated_at = NOW()
      RETURNING id;
    `, [sandboxTenantId]);
    const sandboxBranchId = branchRes.rows[0].id;

    // 3. تدوير كلمة مرور حساب الـ QA وإبطال جميع جلساته السابقة فورياً (Increment token_version)
    const newHash = await bcrypt.hash(qaPassword, 12);
    const userRes = await client.query(`
      INSERT INTO users (email, full_name, password_hash, phone_normalized, is_active, is_super_admin, token_version)
      VALUES ($1, $2, $3, '+966500000099', true, false, 1)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            token_version = users.token_version + 1,
            is_active = true,
            is_super_admin = false,
            updated_at = NOW()
      RETURNING id, token_version;
    `, [qaEmail, qaName, newHash]);
    const qaUserId = userRes.rows[0].id;
    const currentTokenVersion = userRes.rows[0].token_version;

    // 4. عزل الحساب تماماً: سحب أي عضوية سابقة خارج صالون التجارب (حظر الوصول لصالون اللوتس)
    await client.query(`
      DELETE FROM memberships
      WHERE user_id = $1 AND tenant_id != $2;
    `, [qaUserId, sandboxTenantId]);

    // 5. ربط العضوية الحصرية بصالون التجارب كـ salon_manager
    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'salon_manager', $3, true)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = 'salon_manager', branch_id = EXCLUDED.branch_id, is_active = true, updated_at = NOW();
    `, [sandboxTenantId, qaUserId, sandboxBranchId]);

    // 6. إضافة سجلات عميلات اصطناعية داخل صالون التجارب فقط
    const sampleCustomers = [
      { name: 'هند الشمري (تجريبية)', phone: '+966551122334' },
      { name: 'روان القحطاني (تجريبية)', phone: '+966552233445' },
      { name: 'دانة الدوسري (تجريبية)', phone: '+966553344556' },
    ];

    for (const c of sampleCustomers) {
      await client.query(`
        INSERT INTO customers (tenant_id, full_name, phone_normalized)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, phone_normalized) DO NOTHING;
      `, [sandboxTenantId, c.name, c.phone]);
    }

    await client.query('COMMIT');
    console.log('✅ تم تأمين حساب فحص الجودة QA بنجاح:');
    console.log(`  - البريد الإلكتروني: ${qaEmail}`);
    console.log(`  - تم تدوير كلمة المرور وتحديث token_version إلى ${currentTokenVersion} لإبطال أي جلسات سابقة.`);
    console.log(`  - المركز المعين: ${sandboxName} (${sandboxSlug})`);
    console.log('  - تم عزل الحساب وحظر وصوله لأي صالون آخر بنسبة 100%.');
    console.log('  - لم يتم طباعة كلمة المرور أو سلاسل الاتصال لضمان سرية السجلات.');

    return {
      email: qaEmail,
      tenantSlug: sandboxSlug,
      tokenVersion: currentTokenVersion,
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
      console.error('❌ خطأ أثناء تأمين حساب الـ QA:', err.message);
      process.exit(1);
    });
}
