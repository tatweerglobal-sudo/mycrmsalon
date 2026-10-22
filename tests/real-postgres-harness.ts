// tests/real-postgres-harness.ts
// بيئة اختبار حقيقية معزولة ومؤقتة تعمل على PostgreSQL محلي فقط

import path from 'node:path';
import { Pool } from 'pg';
import { setDbPool } from '../src/lib/db';
import { runMigrations } from '../scripts/migrate';

export interface RealPostgresEnv {
  pool: Pool; // دور التطبيق المقيد بـ RLS (salon_app_role)
  adminPool: Pool; // دور الأدمن لتهيئة البيانات (postgres)
  stop: () => Promise<void>;
  resetData: () => Promise<void>;
}

export async function setupTestPostgres(port = 54338): Promise<RealPostgresEnv> {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';

  const dataDir = path.join(process.cwd(), '.test-pg-data-salon');

  const epModule = await import('embedded-postgres');
  const EmbeddedPostgres = epModule.default;

  const ep = new EmbeddedPostgres({
    port,
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
  });

  try {
    await ep.initialise();
  } catch (_e) {
    // تم التهيئة مسبقاً
  }

  try {
    await ep.start();
  } catch (_e) {
    // يعمل بالفعل
  }

  const adminConnString = `postgresql://postgres:password@127.0.0.1:${port}/postgres`;
  process.env.SALON_TEST_DATABASE_URL = adminConnString;

  if (!adminConnString.includes('127.0.0.1') && !adminConnString.includes('localhost')) {
    throw new Error('SECURITY VIOLATION: Test suite must only connect to local disposable database.');
  }

  const adminPool = new Pool({
    connectionString: adminConnString,
    max: 5,
    idleTimeoutMillis: 5000,
  });

  // تشغيل كافة ترقيات الـ SaaS بصلاحية الأدمن
  await runMigrations(adminPool);

  // التأكد الصارم من إنشاء دور التطبيق وضبط صلاحياته بكلمة المرور
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salon_app_role') THEN
          CREATE ROLE salon_app_role WITH LOGIN PASSWORD 'salon_app_secret_test_pass' NOBYPASSRLS NOSUPERUSER;
        ELSE
          ALTER ROLE salon_app_role WITH LOGIN PASSWORD 'salon_app_secret_test_pass' NOBYPASSRLS NOSUPERUSER;
        END IF;
      END
      $$;
      GRANT USAGE ON SCHEMA public TO salon_app_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app_role;
      REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM salon_app_role;

      -- تطبيق قيود الأعمدة الصارمة لمنع تعديل الحقول الحساسة بواسطة دور التطبيق
      REVOKE ALL ON TABLE tenants FROM salon_app_role;
      GRANT SELECT ON TABLE tenants TO salon_app_role;
      GRANT UPDATE (name, timezone, currency, contact_phone, contact_email, settings, updated_at) ON TABLE tenants TO salon_app_role;

      REVOKE ALL ON TABLE users FROM salon_app_role;
      GRANT SELECT ON TABLE users TO salon_app_role;
      GRANT INSERT (id, email, phone_normalized, full_name, password_hash, is_active, token_version) ON TABLE users TO salon_app_role;
      GRANT UPDATE (full_name, phone_normalized, password_hash, token_version, last_login_at, failed_login_attempts, locked_until, updated_at) ON TABLE users TO salon_app_role;
    `);
  } finally {
    adminClient.release();
  }

  // إعداد اتصال التطبيق العادي الخاضع لـ RLS (NOBYPASSRLS)
  const appConnString = `postgresql://salon_app_role:salon_app_secret_test_pass@127.0.0.1:${port}/postgres`;
  const appPool = new Pool({
    connectionString: appConnString,
    max: 5,
    idleTimeoutMillis: 5000,
  });

  setDbPool(appPool);

  const resetData = async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        TRUNCATE TABLE
          audit_logs,
          appointment_services,
          appointments,
          staff_services,
          services,
          service_categories,
          customers,
          salon_staff,
          memberships,
          users,
          branches,
          tenants
        CASCADE;
      `);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  };

  const stop = async () => {
    try {
      await appPool.end();
      await adminPool.end();
      await ep.stop();
    } catch (_e) {
      // إغلاق نظيف
    }
  };

  return {
    pool: appPool,
    adminPool,
    stop,
    resetData,
  };
}
