// scripts/verify-neon-connection.ts
// فحص شامل والتحقق من سلامة الاتصال بسحابة Neon، ودور التشغيل، وعزل المستأجرين
// باستخدام فحوصات غير تدميرية وسجلات تجريبية اصطناعية يتم تنظيفها فوراً

import '../src/lib/load-env';
import { Pool } from 'pg';

export interface VerificationResult {
  success: boolean;
  endpointVerified: boolean;
  neonHost: string;
  connectedUser: string;
  roleConfigured: boolean;
  rlsEnforced: boolean;
  truncateProhibited: boolean;
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

      // 4. اختبار العمليات الحقيقية والعزل المتعدد للمستأجرين بسجلات اصطناعية فريدة
      console.log('🧪 بدء اختبارات CRUD والعزل المتعدد للصالونات بسجلات اصطناعية...');
      const syntheticTenant1 = '00000000-0000-4000-a000-000000000001';
      const syntheticTenant2 = '00000000-0000-4000-a000-000000000002';
      const syntheticBranch1 = '00000000-0000-4000-b000-000000000001';
      const syntheticBranch2 = '00000000-0000-4000-b000-000000000002';

      // تهيئة الصالونين عبر اتصال الإدارة
      await migrationPool.query(`
        INSERT INTO tenants (id, name, slug, country_code)
        VALUES 
          ($1, 'صالون اصطناعي 1 للتأكد', 'synth-salon-01', 'SA'),
          ($2, 'صالون اصطناعي 2 للتأكد', 'synth-salon-02', 'EG')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      `, [syntheticTenant1, syntheticTenant2]);

      await migrationPool.query(`
        INSERT INTO branches (id, tenant_id, name)
        VALUES 
          ($1, $2, 'فرع النخيل الاصطناعي'),
          ($3, $4, 'فرع المعادي الاصطناعي')
        ON CONFLICT (id) DO NOTHING;
      `, [syntheticBranch1, syntheticTenant1, syntheticBranch2, syntheticTenant2]);

      // اختبار إضافة عميلة في الصالون 1 تحت سياق RLS
      await appClient.query('BEGIN');
      try {
        await appClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [syntheticTenant1]);
        
        // إدراج عميلة للصالون 1
        const custRes = await appClient.query(`
          INSERT INTO customers (tenant_id, full_name, phone_normalized)
          VALUES ($1, 'عميلة اصطناعية اختبارية', '+966500000001')
          RETURNING id, full_name, phone_normalized;
        `, [syntheticTenant1]);

        const custId = custRes.rows[0].id;
        console.log(`✅ تم إنشاء عميلة في صالون 1 بنجاح (ID: ${custId})`);

        // التحقق من أن الصالون 1 يرى عميلته
        const readOwn = await appClient.query('SELECT count(*)::int AS cnt FROM customers WHERE id = $1', [custId]);
        if (readOwn.rows[0].cnt !== 1) {
          throw new Error('RLS Failure: Salon 1 could not read its own customer.');
        }

        // اختبار العزل: تحويل السياق إلى صالون 2 ومحاولة رؤية عميلة صالون 1
        await appClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [syntheticTenant2]);
        const leakRead = await appClient.query('SELECT count(*)::int AS cnt FROM customers WHERE id = $1', [custId]);
        if (leakRead.rows[0].cnt !== 0) {
          throw new Error('SECURITY VIOLATION: Cross-tenant data leak! Salon 2 saw Salon 1 customer.');
        }
        console.log('✅ تم التحقق: العزل التام بين الصالونات يعمل بنسبة 100%، صالون 2 لم يستطع رؤية عميلة صالون 1.');

        // اختبار فرادة رقم الهاتف: صالون 2 يستطيع تسجيل نفس الرقم
        const cust2Res = await appClient.query(`
          INSERT INTO customers (tenant_id, full_name, phone_normalized)
          VALUES ($1, 'عميلة صالون 2 بنفس الهاتف', '+966500000001')
          RETURNING id;
        `, [syntheticTenant2]);
        console.log(`✅ تم التحقق: نفس رقم الهاتف مسموح به في صالون مختلف (Tenant-Scoped Phone Uniqueness).`);

        // بينما محاولة تكرار نفس الرقم داخل نفس الصالون 2 ترفض فوراً
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
        }
        if (!dupBlocked) {
          throw new Error('SECURITY VIOLATION: Duplicate phone within the same salon was not rejected!');
        }
        console.log('✅ تم التحقق: تكرار رقم الهاتف داخل نفس الصالون مرفوض ومحمي بقيد uq_tenant_customer_phone.');

        await appClient.query('COMMIT');
      } catch (err) {
        await appClient.query('ROLLBACK');
        throw err;
      }

      // 5. تنظيف دقيق وآمن للسجلات الاصطناعية التجريبية فقط
      console.log('🧹 تنظيف السجلات الاصطناعية...');
      await migrationPool.query(`DELETE FROM tenants WHERE id IN ($1, $2);`, [syntheticTenant1, syntheticTenant2]);
      console.log('✅ تم تنظيف السجلات الاصطناعية بنجاح.');

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
      tenantIsolationVerified: true,
      message: 'تم فحص واختبار قاعدة بيانات Neon الحقيقية بنجاح واجتياز كافة فحوصات العزل والأمان.',
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
      console.log(`Tenant Isolation Verified: ${res.tenantIsolationVerified}`);
      console.log(`Success: ${res.success}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Verification failed:', err.message);
      process.exit(1);
    });
}
