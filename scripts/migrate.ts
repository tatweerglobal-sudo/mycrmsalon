// scripts/migrate.ts
// تشغيل وترقية مخطط قاعدة البيانات للـ SaaS مع تتبع الإصدارات والمعاملات الآمنة

import '../src/lib/load-env';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { getMigrationDbPool } from '../src/lib/db';

export async function runMigrations(customPool?: Pool): Promise<string[]> {
  const pool = customPool || getMigrationDbPool();
  const client = await pool.connect();
  const appliedMigrations: string[] = [];

  try {
    console.log('🔄 بدء فحص وتطبيق ترقيات قاعدة البيانات (PostgreSQL)...');

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
      return [];
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query('SELECT version FROM _schema_migrations');
    const appliedSet = new Set(appliedRows.map((r: { version: string }) => r.version));

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
        appliedMigrations.push(file);
        console.log(`✅ تم تطبيق: ${file} بنجاح.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ فشل تطبيق الترقية ${file}، تم التراجع (ROLLBACK):`, err);
        throw err;
      }
    }

    console.log(`🎉 اكتملت الترقيات بنجاح. (عدد الترقيات الجديدة: ${appliedMigrations.length})`);
    return appliedMigrations;
  } finally {
    client.release();
  }
}

// إذا تم التشغيل مباشرة عبر CLI
if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.mjs'))) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
