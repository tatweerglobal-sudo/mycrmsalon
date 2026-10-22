// scripts/inspect-database.ts
// فحص وقراءة هيكل وبيانات قاعدة البيانات بشكل آمن وبصلاحية قراءة فقط (Read-Only)
// للتحقق من هوية السيرفر، الجداول القائمة، وتاريخ الترقيات قبل إجراء أي تعديل

import '../src/lib/load-env';
import { Pool } from 'pg';

export interface DatabaseInspectionResult {
  connected: boolean;
  database: string;
  user: string;
  serverVersion: string;
  neonHost: string;
  publicTables: string[];
  appliedMigrations: string[];
  hasExistingData: boolean;
  tableRowCounts: Record<string, number>;
  isEmptyDatabase: boolean;
  message: string;
}

export async function inspectDatabase(): Promise<DatabaseInspectionResult> {
  const connectionString = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is not set in environment or .env.local.');
  }

  // استخراج النطاق الآمن دون طباعة كلمات المرور
  const urlObj = new URL(connectionString.replace(/^postgresql:\/\//, 'http://'));
  const neonHost = urlObj.host;

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    try {
      // 1. فحص الهوية والنسخة
      const infoRes = await client.query('SELECT current_database(), current_user, version()');
      const currentDatabase = infoRes.rows[0].current_database;
      const currentUser = infoRes.rows[0].current_user;
      const serverVersion = infoRes.rows[0].version;

      // 2. فحص الجداول الموجودة في public schema
      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      const publicTables = tablesRes.rows.map((r: { table_name: string }) => r.table_name);

      // 3. فحص سجل الترقيات إن وجد
      let appliedMigrations: string[] = [];
      if (publicTables.includes('_schema_migrations')) {
        const migRes = await client.query('SELECT version FROM _schema_migrations ORDER BY applied_at');
        appliedMigrations = migRes.rows.map((r: { version: string }) => r.version);
      }

      // 4. فحص عدد السجلات في كل جدول قائم
      const tableRowCounts: Record<string, number> = {};
      let totalRows = 0;

      for (const table of publicTables) {
        // حماية أسماء الجداول
        if (/^[a-zA-Z0-9_]+$/.test(table)) {
          const countRes = await client.query(`SELECT count(*)::int AS cnt FROM "${table}"`);
          const count = countRes.rows[0].cnt;
          tableRowCounts[table] = count;
          if (table !== '_schema_migrations') {
            totalRows += count;
          }
        }
      }

      const isEmpty = publicTables.length === 0 || (publicTables.length === 1 && publicTables[0] === '_schema_migrations' && totalRows === 0);

      return {
        connected: true,
        database: currentDatabase,
        user: currentUser,
        serverVersion,
        neonHost,
        publicTables,
        appliedMigrations,
        hasExistingData: totalRows > 0,
        tableRowCounts,
        isEmptyDatabase: isEmpty,
        message: isEmpty 
          ? 'قاعدة بيانات جديدة تماماً وخالية من أي جداول مستخدمين سابقة، جاهزة لتطبيق الترقيات بأمان.'
          : `تم العثور على ${publicTables.length} جدول قائم. إجمالي السجلات: ${totalRows}.`,
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// تشغيل مباشر عبر CLI
if (process.argv[1] && process.argv[1].endsWith('inspect-database.ts')) {
  inspectDatabase()
    .then((result) => {
      console.log('--- DATABASE INSPECTION REPORT ---');
      console.log(`Database: ${result.database}`);
      console.log(`Connected User: ${result.user}`);
      console.log(`Neon Host: ${result.neonHost}`);
      console.log(`Public Tables Count: ${result.publicTables.length}`);
      console.log(`Tables: ${result.publicTables.join(', ') || 'None (Empty database)'}`);
      console.log(`Applied Migrations: ${result.appliedMigrations.join(', ') || 'None'}`);
      console.log(`Empty Database: ${result.isEmptyDatabase}`);
      console.log(`Message: ${result.message}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Connection / Inspection failed:', err.message);
      process.exit(1);
    });
}
