// scripts/setup-runtime-role.ts
// أداة ضبط وتهيئة دور salon_app_role على سحابة Neon بكلمة مرور مشفرة وعشوائية
// يتم استدعاؤها عبر حساب المدير SALON_MIGRATION_DATABASE_URL فقط دون كتابة أسرار في Git

import crypto from 'node:crypto';
import { Pool } from 'pg';

export async function setupRuntimeRole(providedPassword?: string): Promise<{
  role: string;
  generatedPassword?: string;
  success: boolean;
}> {
  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required to configure database roles.');
  }

  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  const client = await pool.connect();

  const password = providedPassword || crypto.randomBytes(24).toString('base64url');

  try {
    console.log('🔒 جاري تهيئة صلاحيات دور salon_app_role بالحد الأدنى من الامتيازات...');

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salon_app_role') THEN
          CREATE ROLE salon_app_role WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        ELSE
          ALTER ROLE salon_app_role WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;

        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'neon_superuser') THEN
          BEGIN
            EXECUTE 'REVOKE neon_superuser FROM salon_app_role';
          EXCEPTION WHEN OTHERS THEN
          END;
        END IF;
      END
      $$;
    `);

    // ضبط كلمة المرور بشكل آمن باستخدام استعلام مخصص
    await client.query(`ALTER ROLE salon_app_role WITH PASSWORD $1;`, [password]);

    // تأكيد سحب الصلاحيات الإدارية ومنح القراءة والكتابة فقط
    await client.query(`
      GRANT USAGE ON SCHEMA public TO salon_app_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO salon_app_role;
      REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM salon_app_role;
    `);

    console.log('✅ تم تهيئة وتأمين دور salon_app_role بنجاح.');

    return {
      role: 'salon_app_role',
      generatedPassword: providedPassword ? undefined : password,
      success: true,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('setup-runtime-role.ts')) {
  setupRuntimeRole()
    .then((res) => {
      console.log('Result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
