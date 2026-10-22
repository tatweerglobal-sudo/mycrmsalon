import { Pool, PoolClient } from 'pg';

let globalPool: Pool | null = null;

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
      : 'SALON_DATABASE_URL must refer to the separate My CRM Salon database.');
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

export function setDbPool(pool: Pool): void {
  globalPool = pool;
}

export async function closeDbPool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
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
