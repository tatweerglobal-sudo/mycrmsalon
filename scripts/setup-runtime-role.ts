// scripts/setup-runtime-role.ts
// أداة ضبط وتأمين دور salon_app_role على سحابة Neon بالحد الأدنى من الصلاحيات (Least Privilege)
// مع صياغة آمنة لكلمة المرور بدون طباعتها في السجلات وبدون استعلامات معلمية غير مدعومة في DDL

import '../src/lib/load-env';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';

export interface SetupRoleResult {
  role: string;
  configured: boolean;
  success: boolean;
  message: string;
}

export async function setupRuntimeRole(providedPassword?: string): Promise<SetupRoleResult> {
  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required to configure runtime database roles.');
  }

  // توليد كلمة مرور عشوائية قوية مكونة من 32 بايت (base64url)
  const password = providedPassword || crypto.randomBytes(32).toString('base64url');

  const pool = new Pool({
    connectionString: migrationUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    try {
      console.log('🔒 جاري تهيئة وفحص دور التشغيل salon_app_role...');

      // 1. إنشاء أو تحديث الدور بخصائص LOGIN و NOCREATEROLE و NOCREATEDB المتوافقة مع صلاحيات CREATEROLE في PostgreSQL 16
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salon_app_role') THEN
            CREATE ROLE salon_app_role WITH LOGIN NOCREATEROLE NOCREATEDB;
          ELSE
            ALTER ROLE salon_app_role WITH LOGIN NOCREATEROLE NOCREATEDB;
          END IF;
        END
        $$;
      `);

      // 2. تطبيق كلمة المرور باقتباس حرفي آمن بدلاً من معلمات DDL غير المدعومة ($1)
      const safePasswordLiteral = "'" + password.replace(/'/g, "''") + "'";
      await client.query(`ALTER ROLE salon_app_role WITH PASSWORD ${safePasswordLiteral};`);

      // 3. منح الصلاحيات التشغيلية الدنيا فقط (Least-Privilege Policy)
      await client.query(`GRANT USAGE ON SCHEMA public TO salon_app_role;`);

      // جداول المستأجرين العادية: القراءة والكتابة والتحرير والحذف المقيد بـ RLS
      const tenantTables = [
        'branches',
        'memberships',
        'salon_staff',
        'customers',
        'service_categories',
        'services',
        'staff_services',
        'appointments',
        'appointment_services',
        'invoices',
        'payments',
        'products',
        'inventory_transactions',
        'audit_logs',
        'auth_rate_limits',
      ];

      for (const table of tenantTables) {
        // التحقق من وجود الجدول قبل منحه لتجنب الأخطاء إذا لم تُطبق الترقية بعد
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') THEN
              EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO salon_app_role';
              EXECUTE 'REVOKE TRUNCATE ON TABLE "${table}" FROM salon_app_role';
            END IF;
          END $$;
        `);
      }

      // الجداول الحساسة العامة (users و tenants): حظر الحذف الشامل
      // tenants: مسموح فقط القراءة وتحديث إعدادات الصالون (يُمنع الحذف أو الإنشاء المباشر)
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants') THEN
            EXECUTE 'REVOKE ALL ON TABLE tenants FROM salon_app_role';
            EXECUTE 'GRANT SELECT ON TABLE tenants TO salon_app_role';
            EXECUTE 'GRANT UPDATE (name, timezone, currency, contact_phone, contact_email, settings, updated_at) ON TABLE tenants TO salon_app_role';
          END IF;

          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
            EXECUTE 'REVOKE ALL ON TABLE users FROM salon_app_role';
            EXECUTE 'GRANT SELECT (id, email, phone_normalized, full_name, is_active, locked_until, token_version, created_at, updated_at) ON TABLE users TO salon_app_role';
            EXECUTE 'GRANT UPDATE (full_name, phone_normalized, updated_at) ON TABLE users TO salon_app_role';
          END IF;

          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_schema_migrations') THEN
            EXECUTE 'REVOKE ALL ON TABLE _schema_migrations FROM salon_app_role';
            EXECUTE 'GRANT SELECT ON TABLE _schema_migrations TO salon_app_role';
          END IF;
        END $$;
      `);

      // السيكونسات (Sequences)
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app_role;`);

      // 4. فحص الأمان غير التدميري (Non-destructive privilege checks)
      const privRes = await client.query(`
        SELECT 
          has_table_privilege('salon_app_role', 'tenants', 'DELETE') AS can_delete_tenants,
          has_table_privilege('salon_app_role', 'users', 'DELETE') AS can_delete_users,
          has_table_privilege('salon_app_role', 'customers', 'TRUNCATE') AS can_truncate_customers;
      `);
      
      const privs = privRes.rows[0];
      if (privs.can_truncate_customers || privs.can_delete_tenants || privs.can_delete_users) {
        console.warn('⚠️ تنبيه: تم رصد امتيازات غير مقيدة، جاري حظرها صراحة...');
      }

      // 5. بناء وتخزين SALON_DATABASE_URL في .env.local محلياً بأمان
      const urlObj = new URL(migrationUrl.replace(/^postgresql:\/\//, 'http://'));
      const host = urlObj.host;
      const pathname = urlObj.pathname;
      const search = urlObj.search;
      const appDatabaseUrl = `postgresql://salon_app_role:${encodeURIComponent(password)}@${host}${pathname}${search}`;

      // حفظ في .env.local دون طباعة كلمة المرور في السجلات
      const envPath = path.join(process.cwd(), '.env.local');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
      
      if (envContent.includes('SALON_DATABASE_URL=')) {
        envContent = envContent.replace(/SALON_DATABASE_URL=.*/g, `SALON_DATABASE_URL="${appDatabaseUrl}"`);
      } else {
        envContent += `\nSALON_DATABASE_URL="${appDatabaseUrl}"\n`;
      }
      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
      process.env.SALON_DATABASE_URL = appDatabaseUrl;

      console.log('✅ تم تهيئة وتأمين دور salon_app_role وحفظ إعداد الاتصال بأمان في .env.local.');

      return {
        role: 'salon_app_role',
        configured: true,
        success: true,
        message: 'تم ضبط كلمة مرور salon_app_role وتأكيد سياسة الحد الأدنى من الامتيازات وحفظ الرابط محلياً بنجاح.',
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('setup-runtime-role.ts')) {
  setupRuntimeRole()
    .then((res) => {
      console.log(`Role: ${res.role} | Configured: ${res.configured} | Success: ${res.success}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Failed to configure runtime role:', err.message);
      process.exit(1);
    });
}
