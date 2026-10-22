// scripts/migrate.mjs
// تشغيل وترقية مخطط قاعدة البيانات للـ SaaS مع تتبع الإصدارات

import fs from 'node:fs';
import path from 'node:path';
import { getDbPool } from '../src/lib/db.js';

export async function runMigrations(customPool = null) {
  const pool = customPool || getDbPool();
  const client = await pool.connect();

  try {
    console.log('🔄 بدء فحص وتطبيق ترقيات قاعدة البيانات...');

    // إنشاء جدول تتبع الترقيات إذا لم يكن موجوداً
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(process.cwd(), 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('⚠️ لا يوجد مجلد migrations.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query('SELECT version FROM _schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`⏩ تم تطبيقها مسبقاً: ${file}`);
        continue;
      }

      console.log(`⚡ جاري تطبيق: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ تم تطبيق: ${file} بنجاح.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ فشل تطبيق الترقية ${file}:`, err);
        throw err;
      }
    }

    console.log('🎉 اكتملت جميع الترقيات بنجاح.');
  } finally {
    client.release();
  }
}

// إذا تم التشغيل مباشرة عبر CLI
if (process.argv[1] && process.argv[1].endsWith('migrate.mjs')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
