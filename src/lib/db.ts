import { Pool, PoolClient } from 'pg';

let globalPool: Pool | null = null;
let migrationPool: Pool | null = null;

/**
 * مسبح اتصالات تطبيق الويب للعمليات العادية (Application Runtime Pool)
 * يستخدم صراحة SALON_DATABASE_URL بحساب تشغيلي مقيد (salon_app_role) خاضع إجبارياً لـ RLS.
 */
export function getDbPool(): Pool {
  if (globalPool) {
    return globalPool;
  }

  // Never let tests fall back to the salon production database.
  const isTest = process.env.NODE_ENV === 'test';
  const connectionString = isTest
    ? process.env.SALON_TEST_DATABASE_URL
    : process.env.SALON_DATABASE_URL;

  if (!connectionString) {
    throw new Error(isTest
      ? 'SALON_TEST_DATABASE_URL is required for database tests.'
      : 'SALON_DATABASE_URL must refer to the separate My CRM Salon runtime role database.');
  }
  if (isTest && process.env.SALON_DATABASE_URL === connectionString) {
    throw new Error('Test and production databases must never share credentials.');
  }

  globalPool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  return globalPool;
}

/**
 * مسبح اتصالات الترقيات وإدارة المخطط (Administrative Migration Pool)
 * يستخدم حصرياً SALON_MIGRATION_DATABASE_URL بحساب إداري مرخص لتنفيذ DDL.
 */
export function getMigrationDbPool(): Pool {
  if (migrationPool) {
    return migrationPool;
  }

  const isTest = process.env.NODE_ENV === 'test';
  const connectionString = isTest
    ? process.env.SALON_TEST_DATABASE_URL
    : process.env.SALON_MIGRATION_DATABASE_URL;

  if (!connectionString) {
    throw new Error(isTest
      ? 'SALON_TEST_DATABASE_URL is required for database tests.'
      : 'SALON_MIGRATION_DATABASE_URL is required for database administration and migrations. Database migrations must explicitly use SALON_MIGRATION_DATABASE_URL and cannot fall back to application runtime credentials.');
  }

  migrationPool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10000,
  });

  return migrationPool;
}

export function setDbPool(pool: Pool): void {
  globalPool = pool;
}

export function setMigrationDbPool(pool: Pool): void {
  migrationPool = pool;
}

export async function closeDbPool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
  if (migrationPool) {
    await migrationPool.end();
    migrationPool = null;
  }
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
