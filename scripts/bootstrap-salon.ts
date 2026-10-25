// scripts/bootstrap-salon.ts
// سكريبت التهيئة والتأسيس لحساب صالون أولي ومالك الصالون
// محصن ضد إعادة تعيين كلمة المرور أو تعديل الحسابات القائمة (Idempotent & Safe)

import '../src/lib/load-env';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

export interface BootstrapResult {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  branchId: string;
  userId: string;
  email: string;
  role: string;
  isNewUser: boolean;
  generatedPassword?: string;
}

export async function bootstrapSalon(customPassword?: string): Promise<BootstrapResult> {
  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required to bootstrap salon records.');
  }

  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  const client = await pool.connect();

  const email = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@crmsalon.de').toLowerCase().trim();
  const rawPassword = customPassword || process.env.BOOTSTRAP_OWNER_PASSWORD || crypto.randomBytes(12).toString('base64url') + '@Sa9#';
  const salonName = process.env.BOOTSTRAP_SALON_NAME || 'صالون لوتس بيوتي للتزيين النسائي';
  const salonSlug = process.env.BOOTSTRAP_SALON_SLUG || 'lotus-beauty';

  try {
    console.log(`🚀 بدء فحص/تهيئة صالون معتمد: "${salonName}" (${salonSlug})...`);
    await client.query('BEGIN');

    // 1. إنشاء مركز التجميل (Tenant) دون تدمير البيانات القائمة
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, slug, country_code, timezone, currency, status, subscription_tier, max_branches, max_staff)
      VALUES ($1, $2, 'SA', 'Asia/Riyadh', 'SAR', 'active', 'growth', 3, 15)
      ON CONFLICT (slug) DO UPDATE 
        SET name = EXCLUDED.name, status = 'active', updated_at = NOW()
      RETURNING id, name, slug;
    `, [salonName, salonSlug]);

    const tenant = tenantRes.rows[0];

    // 2. إنشاء الفرع الرئيسي
    const branchRes = await client.query(`
      INSERT INTO branches (tenant_id, name, city, is_main, is_active)
      VALUES ($1, 'الفرع الرئيسي - الرياض', 'الرياض', true, true)
      ON CONFLICT (tenant_id, name) DO UPDATE 
        SET is_active = true, updated_at = NOW()
      RETURNING id;
    `, [tenant.id]);

    const branch = branchRes.rows[0];

    // 3. التحقق أولاً من وجود المستخدم لمنع إعادة تعيين كلمة المرور للمستخدم القائم
    const existingUser = await client.query('SELECT id, email FROM users WHERE LOWER(email) = $1', [email]);
    let userId: string;
    let isNewUser = false;

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
      console.log(`ℹ️ حساب مالك الصالون (${email}) موجود مسبقاً. تم الحفاظ على كلمة المرور السابقة دون أي تعديل.`);
    } else {
      isNewUser = true;
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const userRes = await client.query(`
        INSERT INTO users (email, full_name, password_hash, is_active, phone_normalized)
        VALUES ($1, 'أريج السبيعي (مالكة الصالون)', $2, true, '+966551234567')
        RETURNING id;
      `, [email, passwordHash]);
      userId = userRes.rows[0].id;
      console.log(`✅ تم إنشاء حساب جديد لمالك الصالون.`);
    }

    // 4. ربط العضوية بدور salon_owner دون تكرار
    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'salon_owner', $3, true)
      ON CONFLICT DO NOTHING;
    `, [tenant.id, userId, branch.id]);

    await client.query('COMMIT');

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      branchId: branch.id,
      userId,
      email,
      role: 'salon_owner',
      isNewUser,
      generatedPassword: isNewUser ? rawPassword : undefined,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('bootstrap-salon.ts')) {
  bootstrapSalon()
    .then(async (res) => {
      if (res.isNewUser && res.generatedPassword) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const envPath = path.join(process.cwd(), '.env.local');

        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          if (!envContent.includes('BOOTSTRAP_OWNER_PASSWORD=')) {
            fs.appendFileSync(envPath, `\nBOOTSTRAP_OWNER_PASSWORD=${res.generatedPassword}\n`);
          }
        }
      }

      console.log('\n--- BOOTSTRAP SALON STATUS ---');
      console.log(`Salon Name: ${res.tenantName}`);
      console.log(`Salon Slug: ${res.tenantSlug}`);
      console.log(`Email:      ${res.email}`);
      console.log(`Status:     ${res.isNewUser ? 'Created New Account' : 'Preserved Existing Account'}`);
      console.log(`Role:       ${res.role}`);
      console.log('------------------------------\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Bootstrap failed:', err);
      process.exit(1);
    });
}
