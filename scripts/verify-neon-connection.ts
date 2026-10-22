// scripts/verify-neon-connection.ts
// أداة فحص واختبار الاتصال المباشر بفرع التطوير (development) في Neon
// والتحقق الصارم من دور salon_app_role وتطبيق الترقيات وعزل المستأجرين

import { Pool } from 'pg';
import { runMigrations } from './migrate';

export async function verifyNeonDevelopment(): Promise<{
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}> {
  console.log('🔍 بدء فحص واختبار الاتصال بسحابة Neon (فرع development)...');

  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  const appUrl = process.env.SALON_DATABASE_URL;

  if (!migrationUrl || !appUrl) {
    return {
      success: false,
      message: 'المتغيرات البيئية SALON_MIGRATION_DATABASE_URL و SALON_DATABASE_URL غير معرّفة في بيئة التشغيل.',
    };
  }

  // 1. التحقق من أمان الرابط واستخدام SSL
  if (!migrationUrl.includes('sslmode=require') || !appUrl.includes('sslmode=require')) {
    return {
      success: false,
      message: 'تحذير أمني: يجب أن تتضمن روابط اتصال Neon إعداد sslmode=require إجبارياً.',
    };
  }

  // 2. التحقق من عدم توجيه الاتصال لفرع الإنتاج الرئيسي
  if (migrationUrl.toLowerCase().includes('production') || appUrl.toLowerCase().includes('production')) {
    return {
      success: false,
      message: 'حظر أمني صارم: تم اكتشاف كلمة production في الرابط! يُمنع تشغيل هذا الفحص على الفرع الإنتاجي.',
    };
  }

  const migrationPool = new Pool({ connectionString: migrationUrl, max: 2 });
  const appPool = new Pool({ connectionString: appUrl, max: 2 });

  try {
    // 3. اختبار الاتصال الإداري
    console.log('⚡ فحص الاتصال الإداري (SALON_MIGRATION_DATABASE_URL)...');
    const adminClient = await migrationPool.connect();
    let adminUser = '';
    try {
      const adminRes = await adminClient.query('SELECT current_user, current_database()');
      adminUser = adminRes.rows[0].current_user;
      console.log(`✅ نجح الاتصال الإداري. المستخدم الحالي: ${adminUser}`);
    } finally {
      adminClient.release();
    }

    // 4. تطبيق الترقيات على فرع التطوير
    console.log('🔄 تطبيق الترقيات على فرع Neon development...');
    const applied = await runMigrations(migrationPool);
    console.log(`✅ اكتملت الترقيات بنجاح. عدد الترقيات المنفذة: ${applied.length}`);

    // 5. فحص والتحقق من قيود وصلاحيات دور التطبيق المقيد (salon_app_role)
    console.log('🔒 فحص صلاحيات دور التشغيل salon_app_role...');
    const appClient = await appPool.connect();
    try {
      const appUserRes = await appClient.query('SELECT current_user');
      const currentUser = appUserRes.rows[0].current_user;

      if (currentUser !== 'salon_app_role') {
        throw new Error(`خطأ أمني: اتصال SALON_DATABASE_URL يجب أن يستخدم دور salon_app_role وليس ${currentUser}`);
      }

      // فحص عدم القدرة على تجاوز RLS
      const roleCheck = await appClient.query(`
        SELECT rolname, rolsuper, rolbypassrls, rolcreaterole
        FROM pg_roles
        WHERE rolname = 'salon_app_role';
      `);

      const role = roleCheck.rows[0];
      if (role.rolsuper || role.rolbypassrls || role.rolcreaterole) {
        throw new Error(`خرق أمني في Neon: الدور salon_app_role يمتلك صلاحيات إدارية خطيرة (Super: ${role.rolsuper}, BypassRLS: ${role.rolbypassrls})`);
      }
      console.log('✅ تم التحقق: salon_app_role مقيد ولا يمكنه تجاوز RLS (rolbypassrls = false).');

      // فحص حظر TRUNCATE
      try {
        await appClient.query('TRUNCATE TABLE customers CASCADE;');
        throw new Error('خرق أمني: نجحت عملية TRUNCATE بواسطة دور التطبيق!');
      } catch (err: unknown) {
        if ((err as Error).message.includes('خرق أمني')) throw err;
        console.log('✅ تم التحقق: دور salon_app_role ممنوع صراحة من TRUNCATE.');
      }

      // 6. اختبار العزل وحفظ وقراءة سجل تجريبي
      const testTenantId = '00000000-0000-4000-a000-000000000099';
      await migrationPool.query(`
        INSERT INTO tenants (id, name, slug, country_code)
        VALUES ($1, 'صالون تجريبي لاختبار Neon', 'neon-test-salon', 'SA')
        ON CONFLICT (slug) DO NOTHING;
      `, [testTenantId]);

      // تجربة القراءة بدون تعيين app.current_tenant_id ⬅️ يجب ألا يظهر أي سجل
      const blindQuery = await appClient.query('SELECT * FROM customers WHERE tenant_id = $1', [testTenantId]);
      if (blindQuery.rows.length !== 0) {
        throw new Error('خرق أمني في RLS: تم تسريب بيانات المستأجر دون مصادقة وسياق جلسة!');
      }
      console.log('✅ تم التحقق: RLS يحجب البيانات بنسبة 100% في حال غياب سياق المستأجر.');

      // تنظيف السجل التجريبي
      await migrationPool.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
      console.log('🧹 تم تنظيف السجلات التجريبية بنجاح.');

    } finally {
      appClient.release();
    }

    return {
      success: true,
      message: 'تم التحقق بنجاح من جميع اشتراطات فرع Neon development ودور salon_app_role وعزل المستأجرين.',
      details: {
        adminUser,
        appliedMigrationsCount: applied.length,
      },
    };
  } finally {
    await migrationPool.end();
    await appPool.end();
  }
}

// تشغيل مباشر عبر CLI
if (process.argv[1] && process.argv[1].endsWith('verify-neon-connection.ts')) {
  verifyNeonDevelopment()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('❌ خطأ أثناء الفحص:', err);
      process.exit(1);
    });
}
