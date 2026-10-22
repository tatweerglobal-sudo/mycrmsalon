import { Pool, PoolClient } from 'pg';

let globalPool: Pool | null = null;

export function getDbPool(): Pool {
  if (globalPool) {
    return globalPool;
  }

  const connectionString =
    process.env.NODE_ENV === 'test' && process.env.SALON_TEST_DATABASE_URL
      ? process.env.SALON_TEST_DATABASE_URL
      : process.env.SALON_DATABASE_URL;

  if (!connectionString) {
    throw new Error('SALON_DATABASE_URL must refer to the separate My CRM Salon database.');
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
