// scripts/audit-production-db.ts
import '../src/lib/load-env';
import { getMigrationDbPool } from '../src/lib/db';

async function audit() {
  const pool = getMigrationDbPool();
  try {
    const tenants = await pool.query('SELECT id, name, slug, status FROM tenants');
    const users = await pool.query('SELECT id, email, full_name, is_super_admin, is_active FROM users');
    const customers = await pool.query('SELECT count(*)::int as count FROM customers');
    const appointments = await pool.query('SELECT count(*)::int as count FROM appointments');
    const branches = await pool.query('SELECT count(*)::int as count FROM branches');

    console.log('--- NEON AUDIT DATA ---');
    console.log('Tenants:', JSON.stringify(tenants.rows));
    console.log('Users:', JSON.stringify(users.rows));
    console.log('Customers Count:', customers.rows[0].count);
    console.log('Appointments Count:', appointments.rows[0].count);
    console.log('Branches Count:', branches.rows[0].count);
  } finally {
    await pool.end();
  }
}

audit();
