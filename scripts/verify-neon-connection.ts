// scripts/verify-neon-connection.ts
// فحص شامل والتحقق من سلامة الاتصال بسحابة Neon، ودور التشغيل، وعزل المستأجرين
// باستخدام معرفات اصطناعية فريدة ديناميكياً وتنظيف موثوق عبر try/finally

import '../src/lib/load-env';
import crypto from 'node:crypto';
import { Pool } from 'pg';

export interface VerificationResult {
  success: boolean;
  endpointVerified: boolean;
  neonHost: string;
  connectedUser: string;
  roleConfigured: boolean;
  rlsEnforced: boolean;
  truncateProhibited: boolean;
  columnSecurityVerified: boolean;
  tenantIsolationVerified: boolean;
  message: string;
}

export async function verifyNeonConnection(): Promise<VerificationResult> {
  console.log('🔍 بدء فحص واختبار الاتصال المباشر بسحابة Neon...');

  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  const appUrl = process.env.SALON_DATABASE_URL;

  if (!migrationUrl || !appUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL and SALON_DATABASE_URL must both be set in .env.local.');
  }

  // 1. التحقق من صيغة الرابط وSSL ونطاق Neon
  if (!migrationUrl.includes('sslmode=require') || !appUrl.includes('sslmode=require')) {
    throw new Error('SECURITY ERROR: Neon connection strings must include sslmode=require.');
  }

  const urlObj = new URL(migrationUrl.replace(/^postgresql:\/\//, 'http://'));
  const neonHost = urlObj.host;

  if (!neonHost.includes('.neon.tech')) {
    throw new Error(`SECURITY ERROR: Host "${neonHost}" is not a recognized Neon database endpoint.`);
  }

  console.log(`📡 تم التحقق من نقطة اتصال Neon المعتمدة: ${neonHost}`);

  const migrationPool = new Pool({ connectionString: migrationUrl, max: 2, connectionTimeoutMillis: 10000 });
  const appPool = new Pool({ connectionString: appUrl, max: 2, connectionTimeoutMillis: 10000 });

  // توليد معرفات اصطناعية فريدة تماماً لكل جولة اختبار لمنع التداخل
  const runTag = crypto.randomBytes(3).toString('hex');
  const syntheticTenant1 = crypto.randomUUID();
  const syntheticTenant2 = crypto.randomUUID();
  const syntheticUser1 = crypto.randomUUID();
  const syntheticUser2 = crypto.randomUUID();
  const syntheticBranch1 = crypto.randomUUID();
  const syntheticBranch2 = crypto.randomUUID();

  try {
    // 2. التحقق من المستخدم الإداري المتصل
    const adminClient = await migrationPool.connect();
    let adminUser = '';
    try {
      const userRes = await adminClient.query('SELECT current_user, current_database()');
      adminUser = userRes.rows[0].current_user;
      console.log(`👑 اتصال الإدارة (SALON_MIGRATION_DATABASE_URL): مستخدم "${adminUser}" على قاعدة "${userRes.rows[0].current_database}"`);
    } finally {
      adminClient.release();
    }

    // 3. التحقق من دور التطبيق salon_app_role بصلاحيات غير تدميرية
    const appClient = await appPool.connect();
    let appUser = '';
    let rlsEnforced = false;
    let truncateProhibited = false;
    let columnSecurityVerified = false;

    try {
      const appUserRes = await appClient.query('SELECT current_user');
      appUser = appUserRes.rows[0].current_user;
      console.log(`🛡️ اتصال التطبيق (SALON_DATABASE_URL): مستخدم "${appUser}"`);

      if (appUser !== 'salon_app_role') {
        throw new Error(`SECURITY ERROR: SALON_DATABASE_URL must connect as salon_app_role, but connected as "${appUser}".`);
      }

      // فحص خصائص الدور من pg_roles
      const roleProps = await appClient.query(`
        SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb 
        FROM pg_roles 
        WHERE rolname = 'salon_app_role';
      `);

      const r = roleProps.rows[0];
      if (r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb) {
        throw new Error(`SECURITY VIOLATION: salon_app_role has administrative attributes (super: ${r.rolsuper}, bypassRLS: ${r.rolbypassrls}).`);
      }
      rlsEnforced = !r.rolbypassrls;

      // فحص حظر TRUNCATE بشكل غير تدميري باستخدام has_table_privilege
      const privCheck = await appClient.query(`
        SELECT has_table_privilege('salon_app_role', 'customers', 'TRUNCATE') AS can_truncate;
      `);
      truncateProhibited = !privCheck.rows[0].can_truncate;

      if (!truncateProhibited) {
        throw new Error('SECURITY VIOLATION: salon_app_role has TRUNCATE privilege on customers table.');
      }
      console.log('✅ تم التحقق (غير تدميري): salon_app_role ممنوع تماماً من TRUNCATE و BypassRLS.');

      // 4. تهيئة بيانات اصطناعية عبر اتصال الإدارة
      console.log(`🧪 تهيئة سجلات اصطناعية فريدة (وسم: ${runTag})...`);
      
      try {
        await migrationPool.query(`
          INSERT INTO tenants (id, name, slug, country_code, subscription_tier)
          VALUES 
            ($1, 'صالون اصطناعي 1 للتأكد', 'synth-salon-1-${runTag}', 'SA', 'starter'),
            ($2, 'صالون اصطناعي 2 للتأكد', 'synth-salon-2-${runTag}', 'EG', 'starter');
        `, [syntheticTenant1, syntheticTenant2]);

        await migrationPool.query(`
          INSERT INTO users (id, email, full_name, password_hash, is_super_admin)
          VALUES 
            ($1, 'user1-${runTag}@salon.test', 'مالكة صالون 1', '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890', false),
            ($2, 'user2-${runTag}@salon.test', 'مالكة صالون 2', '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890', false);
        `, [syntheticUser1, syntheticUser2]);

        await migrationPool.query(`
          INSERT INTO memberships (tenant_id, user_id, role)
          VALUES 
            ($1, $2, 'salon_owner'),
            ($3, $4, 'salon_owner');
        `, [syntheticTenant1, syntheticUser1, syntheticTenant2, syntheticUser2]);

        await migrationPool.query(`
          INSERT INTO branches (id, tenant_id, name)
          VALUES 
            ($1, $2, 'فرع النخيل الاصطناعي'),
            ($3, $4, 'فرع المعادي الاصطناعي');
        `, [syntheticBranch1, syntheticTenant1, syntheticBranch2, syntheticTenant2]);

        // اختبار 1: فحص حماية وحجب tenants تحت RLS
        await appClient.query('BEGIN');
        try {
          await appClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [syntheticTenant1]);
          await appClient.query(`SELECT set_config('app.current_user_id', $1, true)`, [syntheticUser1]);

          // يجب أن يرى صالون 1 فقط صالونه الخاص
          const tenantRows = await appClient.query('SELECT id, name FROM tenants WHERE id IN ($1, $2)', [syntheticTenant1, syntheticTenant2]);
          if (tenantRows.rows.length !== 1 || tenantRows.rows[0].id !== syntheticTenant1) {
            throw new Error('SECURITY VIOLATION: RLS failed on tenants table! User saw other tenants.');
          }
          console.log('✅ تم التحقق: جدول tenants محمي بـ RLS؛ صالون 1 لا يستطيع رؤية سجل صالون 2.');

          // فحص Column-Level Security على tenants: محاولة ترقية الباقة
          await appClient.query('SAVEPOINT sp_tier');
          let subTierBlocked = false;
          try {
            await appClient.query(`UPDATE tenants SET subscription_tier = 'enterprise' WHERE id = $1`, [syntheticTenant1]);
          } catch (e: unknown) {
            const err = e as { code?: string; message: string };
            if (err.code === '42501' || err.message.includes('permission denied')) {
              subTierBlocked = true;
            }
          } finally {
            await appClient.query('ROLLBACK TO SAVEPOINT sp_tier');
          }
          if (!subTierBlocked) {
            throw new Error('SECURITY VIOLATION: salon_app_role was able to modify privileged column subscription_tier!');
          }
          console.log('✅ تم التحقق (Column Security): محاولة ترقية subscription_tier محظورة على salon_app_role.');

          // فحص Column-Level Security على users: محاولة ترقية super_admin
          await appClient.query('SAVEPOINT sp_admin');
          let superAdminBlocked = false;
          try {
            await appClient.query(`UPDATE users SET is_super_admin = true WHERE id = $1`, [syntheticUser1]);
          } catch (e: unknown) {
            const err = e as { code?: string; message: string };
            if (err.code === '42501' || err.message.includes('permission denied')) {
              superAdminBlocked = true;
            }
          } finally {
            await appClient.query('ROLLBACK TO SAVEPOINT sp_admin');
          }
          if (!superAdminBlocked) {
            throw new Error('SECURITY VIOLATION: salon_app_role was able to modify privileged column is_super_admin!');
          }
          console.log('✅ تم التحقق (Column Security): محاولة تفعيل is_super_admin محظورة على salon_app_role.');
          columnSecurityVerified = true;

          // اختبار 2: إدراج وقراءة عميلة في صالون 1
          const custRes = await appClient.query(`
            INSERT INTO customers (tenant_id, full_name, phone_normalized)
            VALUES ($1, 'عميلة اصطناعية اختبارية', '+966500000001')
            RETURNING id, full_name, phone_normalized;
          `, [syntheticTenant1]);

          const custId = custRes.rows[0].id;
          console.log(`✅ تم إنشاء عميلة في صالون 1 بنجاح (ID: ${custId})`);

          // اختبار 3: عزل الصالونات عند استعلام صالون 2
          await appClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [syntheticTenant2]);
          await appClient.query(`SELECT set_config('app.current_user_id', $1, true)`, [syntheticUser2]);

          const leakRead = await appClient.query('SELECT count(*)::int AS cnt FROM customers WHERE id = $1', [custId]);
          if (leakRead.rows[0].cnt !== 0) {
            throw new Error('SECURITY VIOLATION: Cross-tenant data leak! Salon 2 saw Salon 1 customer.');
          }
          console.log('✅ تم التحقق: عزل المستأجرين يعمل بنسبة 100%؛ صالون 2 لم يستطع رؤية عميلة صالون 1.');

          // اختبار فرادة رقم الهاتف
          await appClient.query(`
            INSERT INTO customers (tenant_id, full_name, phone_normalized)
            VALUES ($1, 'عميلة صالون 2 بنفس الهاتف', '+966500000001')
            RETURNING id;
          `, [syntheticTenant2]);
          console.log(`✅ تم التحقق: نفس رقم الهاتف مسموح به في صالون مختلف.`);

          await appClient.query('SAVEPOINT sp_dup');
          let dupBlocked = false;
          try {
            await appClient.query(`
              INSERT INTO customers (tenant_id, full_name, phone_normalized)
              VALUES ($1, 'محاولة مكررة بنفس الصالون', '+966500000001');
            `, [syntheticTenant2]);
          } catch (dupErr: unknown) {
            if ((dupErr as { code?: string }).code === '23505') {
              dupBlocked = true;
            }
          } finally {
            await appClient.query('ROLLBACK TO SAVEPOINT sp_dup');
          }
          if (!dupBlocked) {
            throw new Error('SECURITY VIOLATION: Duplicate phone within the same salon was not rejected!');
          }
          console.log('✅ تم التحقق: تكرار رقم الهاتف داخل نفس الصالون مرفوض ومحمي بقيد uq_tenant_customer_phone.');

          // اختبار دالة تسجيل الدخول الآمنة auth_lookup_user_for_login
          const authLookupRes = await appClient.query('SELECT * FROM auth_lookup_user_for_login($1)', [`user1-${runTag}@salon.test`]);
          if (authLookupRes.rows.length !== 1 || authLookupRes.rows[0].id !== syntheticUser1) {
            throw new Error('Authentication function auth_lookup_user_for_login failed to return user.');
          }
          console.log('✅ تم التحقق: دالة auth_lookup_user_for_login تعمل بسلاسة وأمان.');

          await appClient.query('COMMIT');
        } catch (err) {
          await appClient.query('ROLLBACK');
          throw err;
        }

      } finally {
        // 5. تنظيف دقيق وموثوق للسجلات الاصطناعية المحددة فقط
        console.log('🧹 تنظيف السجلات الاصطناعية المحددة...');
        await migrationPool.query(`DELETE FROM memberships WHERE tenant_id IN ($1, $2);`, [syntheticTenant1, syntheticTenant2]);
        await migrationPool.query(`DELETE FROM customers WHERE tenant_id IN ($1, $2);`, [syntheticTenant1, syntheticTenant2]);
        await migrationPool.query(`DELETE FROM branches WHERE tenant_id IN ($1, $2);`, [syntheticTenant1, syntheticTenant2]);
        await migrationPool.query(`DELETE FROM tenants WHERE id IN ($1, $2);`, [syntheticTenant1, syntheticTenant2]);
        await migrationPool.query(`DELETE FROM users WHERE id IN ($1, $2);`, [syntheticUser1, syntheticUser2]);
        console.log('✅ تم تنظيف كافة السجلات الاصطناعية الخاصة بهذه الجولة بنجاح.');
      }

    } finally {
      appClient.release();
    }

    return {
      success: true,
      endpointVerified: true,
      neonHost,
      connectedUser: adminUser,
      roleConfigured: true,
      rlsEnforced,
      truncateProhibited,
      columnSecurityVerified,
      tenantIsolationVerified: true,
      message: 'تم فحص واختبار قاعدة بيانات Neon الحقيقية بنجاح واجتياز كافة فحوصات العزل والأمان والمصادقة.',
    };
  } finally {
    await migrationPool.end();
    await appPool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-neon-connection.ts')) {
  verifyNeonConnection()
    .then((res) => {
      console.log('\n--- NEON VERIFICATION SUMMARY ---');
      console.log(`Neon Host: ${res.neonHost}`);
      console.log(`Connected User: ${res.connectedUser}`);
      console.log(`RLS Enforced: ${res.rlsEnforced}`);
      console.log(`TRUNCATE Prohibited: ${res.truncateProhibited}`);
      console.log(`Column Security Verified: ${res.columnSecurityVerified}`);
      console.log(`Tenant Isolation Verified: ${res.tenantIsolationVerified}`);
      console.log(`Success: ${res.success}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Verification failed:', err.message);
      process.exit(1);
    });
}
