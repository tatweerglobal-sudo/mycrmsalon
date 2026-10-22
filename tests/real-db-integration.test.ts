// tests/real-db-integration.test.ts
// اختبارات تكامل حقيقية شاملة على خادم PostgreSQL معزول ومؤقت
// تشمل: الترقيات والتراجع، RLS بكافة عملياته، عزل المستأجرين، القيود المركبة، وحالة الجلسات

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestPostgres, type RealPostgresEnv } from './real-postgres-harness';
import { runMigrations } from '../scripts/migrate';
import { withTenantDb } from '../src/lib/auth/tenant-context';
import { validateSessionState, revokeAllUserSessions, type SessionPayload } from '../src/lib/auth/session';
import { PostgresRateLimiter } from '../src/lib/auth/rate-limiter';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

let env: RealPostgresEnv;
let tenant1Id: string;
let tenant2Id: string;
let branch1Id: string;
let branch2Id: string;
let user1Id: string;
let user2Id: string;

before(async () => {
  env = await setupTestPostgres(54338);
});

after(async () => {
  if (env) {
    await env.stop();
  }
});

// ==============================================================================
// 1. اختبارات سلامة الترقية وتتبع الإصدارات والتراجع (Migration & Rollback)
// ==============================================================================

test('Migrations table exists and records applied migrations in real Postgres', async () => {
  const { rows } = await env.adminPool.query('SELECT version, applied_at FROM _schema_migrations');
  assert.ok(rows.some((r: { version: string }) => r.version === '001_initial_saas_schema.sql'));
  assert.ok(rows.some((r: { version: string }) => r.version === '002_security_hardening.sql'));
});

test('Re-running migrations is idempotent and safe (no re-application or errors)', async () => {
  const newlyApplied = await runMigrations(env.adminPool);
  assert.equal(newlyApplied.length, 0); // لم يتم تطبيق أي ملف جديد لأنها مطبقة مسبقاً
});

test('Failed migration transaction safely rolls back and does not record version', async () => {
  const client = await env.adminPool.connect();
  try {
    await client.query('BEGIN');
    let failed = false;
    try {
      await client.query('CREATE TABLE temp_test_table (id INT PRIMARY KEY);');
      // خطأ نحوي متعمد
      await client.query('INVALID SQL STATEMENT CAUSING FAILURE;');
      await client.query("INSERT INTO _schema_migrations (version) VALUES ('999_failed.sql');");
      await client.query('COMMIT');
    } catch (_err) {
      await client.query('ROLLBACK');
      failed = true;
    }

    assert.equal(failed, true);

    const tableCheck = await client.query(`
      SELECT to_regclass('public.temp_test_table') as table_exists;
    `);
    assert.equal(tableCheck.rows[0].table_exists, null);

    const versionCheck = await client.query(`
      SELECT * FROM _schema_migrations WHERE version = '999_failed.sql';
    `);
    assert.equal(versionCheck.rows.length, 0);
  } finally {
    client.release();
  }
});

// ==============================================================================
// 2. اختبارات عزل المستأجرين و RLS الحقيقية (Multi-Tenant Isolation)
// ==============================================================================

beforeEach(async () => {
  await env.resetData();

  const client = await env.adminPool.connect();
  try {
    // إنشاء مركزين مستقلين (Tenant 1 و Tenant 2)
    const t1 = await client.query(`
      INSERT INTO tenants (name, slug, country_code, currency)
      VALUES ('صالون النرجس', 'al-narges-sa', 'SA', 'SAR')
      RETURNING id;
    `);
    tenant1Id = t1.rows[0].id;

    const t2 = await client.query(`
      INSERT INTO tenants (name, slug, country_code, currency)
      VALUES ('صالون لوتس', 'lotus-eg', 'EG', 'EGP')
      RETURNING id;
    `);
    tenant2Id = t2.rows[0].id;

    // إنشاء فرع لكل مركز
    const b1 = await client.query(`
      INSERT INTO branches (tenant_id, name, city, is_main)
      VALUES ($1, 'فرع الرياض العليا', 'الرياض', true)
      RETURNING id;
    `, [tenant1Id]);
    branch1Id = b1.rows[0].id;

    const b2 = await client.query(`
      INSERT INTO branches (tenant_id, name, city, is_main)
      VALUES ($1, 'فرع القاهرة المعادي', 'القاهرة', true)
      RETURNING id;
    `, [tenant2Id]);
    branch2Id = b2.rows[0].id;

    // إنشاء مستخدمين وعضويات
    const passHash = await hashPassword('SecureSal0n#2026');
    const u1 = await client.query(`
      INSERT INTO users (email, full_name, password_hash)
      VALUES ('owner1@narges.sa', 'أميرة العتيبي', $1)
      RETURNING id;
    `, [passHash]);
    user1Id = u1.rows[0].id;

    const u2 = await client.query(`
      INSERT INTO users (email, full_name, password_hash)
      VALUES ('owner2@lotus.eg', 'نورهان فوزي', $1)
      RETURNING id;
    `, [passHash]);
    user2Id = u2.rows[0].id;

    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id)
      VALUES ($1, $2, 'salon_owner', $3);
    `, [tenant1Id, user1Id, branch1Id]);

    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id)
      VALUES ($1, $2, 'salon_owner', $3);
    `, [tenant2Id, user2Id, branch2Id]);
  } finally {
    client.release();
  }
});

test('Real PostgreSQL RLS strictly isolates SELECT queries between tenants', async () => {
  const session1: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    branchId: branch1Id,
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  const session2: SessionPayload = {
    userId: user2Id,
    tenantId: tenant2Id,
    role: 'salon_owner',
    branchId: branch2Id,
    email: 'owner2@lotus.eg',
    fullName: 'نورهان فوزي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  // مركز 1 يضيف عميلة عبر دور التطبيق المقيد بـ RLS
  await withTenantDb(env.pool, session1, async (client, ctx) => {
    await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'سارة أحمد', '+966501234567');
    `, [ctx.tenantId]);
  });

  // مركز 2 يضيف عميلة خاصة به
  await withTenantDb(env.pool, session2, async (client, ctx) => {
    await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'منى إبراهيم', '+201012345678');
    `, [ctx.tenantId]);
  });

  // استعلام مركز 1 يجب أن يعيد فقط عميلة مركز 1 (1 صف)
  const customersT1 = await withTenantDb(env.pool, session1, async (client) => {
    const res = await client.query('SELECT full_name, phone_normalized FROM customers');
    return res.rows;
  });
  assert.equal(customersT1.length, 1);
  assert.equal(customersT1[0].full_name, 'سارة أحمد');

  // استعلام مركز 2 يجب أن يعيد فقط عميلة مركز 2 (1 صف)
  const customersT2 = await withTenantDb(env.pool, session2, async (client) => {
    const res = await client.query('SELECT full_name, phone_normalized FROM customers');
    return res.rows;
  });
  assert.equal(customersT2.length, 1);
  assert.equal(customersT2[0].full_name, 'منى إبراهيم');
});

test('Real PostgreSQL RLS blocks cross-tenant INSERT via WITH CHECK', async () => {
  const session1: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  // محاولة مستخدم من مركز 1 إدراج عميل وتعيين tenant_id لمركز 2 ⬅️ يفشل RLS فوراً
  await assert.rejects(async () => {
    await withTenantDb(env.pool, session1, async (client) => {
      await client.query(`
        INSERT INTO customers (tenant_id, full_name, phone_normalized)
        VALUES ($1, 'عميلة محقونة', '+966599999999');
      `, [tenant2Id]);
    });
  }, /violates row-level security policy/);
});

test('Real PostgreSQL RLS blocks cross-tenant UPDATE and DELETE', async () => {
  const session1: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  const session2: SessionPayload = {
    userId: user2Id,
    tenantId: tenant2Id,
    role: 'salon_owner',
    email: 'owner2@lotus.eg',
    fullName: 'نورهان فوزي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  let customer2Id: string;
  await withTenantDb(env.pool, session2, async (client, ctx) => {
    const res = await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'فاطمة علي', '+201122334455')
      RETURNING id;
    `, [ctx.tenantId]);
    customer2Id = res.rows[0].id;
  });

  // مركز 1 يحاول تعديل عميلة مركز 2 بالـ id المباشر
  const updateRes = await withTenantDb(env.pool, session1, async (client) => {
    const res = await client.query(`
      UPDATE customers SET full_name = 'اسم معدل خبيث' WHERE id = $1;
    `, [customer2Id]);
    return res.rowCount;
  });
  assert.equal(updateRes, 0);

  // مركز 1 يحاول حذف عميلة مركز 2
  const deleteRes = await withTenantDb(env.pool, session1, async (client) => {
    const res = await client.query(`
      DELETE FROM customers WHERE id = $1;
    `, [customer2Id]);
    return res.rowCount;
  });
  assert.equal(deleteRes, 0);

  // التأكد من أن عميلة مركز 2 لم تتأثر إطلاقاً
  const verifyRes = await withTenantDb(env.pool, session2, async (client) => {
    const res = await client.query(`SELECT full_name FROM customers WHERE id = $1`, [customer2Id]);
    return res.rows[0];
  });
  assert.equal(verifyRes.full_name, 'فاطمة علي');
});

test('Tenant-scoped uniqueness allows identical phone across salons but rejects duplicate within same salon in real Postgres', async () => {
  const session1: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  const session2: SessionPayload = {
    userId: user2Id,
    tenantId: tenant2Id,
    role: 'salon_owner',
    email: 'owner2@lotus.eg',
    fullName: 'نورهان فوزي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  const sharedPhone = '+966509998877';

  // 1. إضافة الرقم لمركز 1
  await withTenantDb(env.pool, session1, async (client, ctx) => {
    await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'ريم عبد الله', $2);
    `, [ctx.tenantId, sharedPhone]);
  });

  // 2. إضافة نفس الرقم لمركز 2 ⬅️ تنجح تماماً
  await withTenantDb(env.pool, session2, async (client, ctx) => {
    await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'ريم عبد الله - زيارة القاهرة', $2);
    `, [ctx.tenantId, sharedPhone]);
  });

  // 3. محاولة تكرار نفس الرقم لمركز 1 مجدداً ⬅️ تفشل بقيد الفرادة المركب 23505
  await assert.rejects(async () => {
    await withTenantDb(env.pool, session1, async (client, ctx) => {
      await client.query(`
        INSERT INTO customers (tenant_id, full_name, phone_normalized)
        VALUES ($1, 'ريم عبد الله ثانية', $2);
      `, [ctx.tenantId, sharedPhone]);
    });
  }, (err: unknown) => {
    return (err as { code?: string }).code === '23505' ||
           (err as Error).message.includes('uq_tenant_customer_phone');
  });
});

test('Composite foreign keys reject cross-tenant foreign key injection', async () => {
  const session1: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    branchId: branch1Id,
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  const session2: SessionPayload = {
    userId: user2Id,
    tenantId: tenant2Id,
    role: 'salon_owner',
    branchId: branch2Id,
    email: 'owner2@lotus.eg',
    fullName: 'نورهان فوزي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  let cust2Id: string;
  await withTenantDb(env.pool, session2, async (client, ctx) => {
    const res = await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_normalized)
      VALUES ($1, 'عميلة المركز الثاني', '+201099887766')
      RETURNING id;
    `, [ctx.tenantId]);
    cust2Id = res.rows[0].id;
  });

  // محاولة مركز 1 حجز موعد مع تحديد customer_id تابع لمركز 2!
  // القيد المركب: FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
  // يمنع هذه العملية فوراً على مستوى قاعدة البيانات
  await assert.rejects(async () => {
    await withTenantDb(env.pool, session1, async (client, ctx) => {
      await client.query(`
        INSERT INTO appointments (
          tenant_id, branch_id, customer_id, starts_at, ends_at, status
        )
        VALUES (
          $1, $2, $3, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'booked'
        );
      `, [ctx.tenantId, branch1Id, cust2Id]);
    });
  }, (err: unknown) => {
    return (err as { code?: string }).code === '23503' ||
           (err as Error).message.includes('fk_apt_tenant_customer');
  });
});

test('Stateful session validation handles active, suspended, role changed, and token revocation', async () => {
  const session: SessionPayload = {
    userId: user1Id,
    tenantId: tenant1Id,
    role: 'salon_owner',
    tokenVersion: 1,
    email: 'owner1@narges.sa',
    fullName: 'أميرة العتيبي',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  // 1. جلسة نشطة صالحة
  const validCheck = await validateSessionState(env.pool, session);
  assert.equal(validCheck.valid, true);

  // 2. إبطال الجلسة عبر رفع token_version
  await revokeAllUserSessions(env.adminPool, user1Id);
  const revokedCheck = await validateSessionState(env.pool, session);
  assert.equal(revokedCheck.valid, false);
  assert.match(revokedCheck.reason || '', /إبطال/);

  // 3. مستخدم موقوف
  await env.adminPool.query(`UPDATE users SET is_active = false, token_version = 1 WHERE id = $1`, [user1Id]);
  const suspendedCheck = await validateSessionState(env.pool, session);
  assert.equal(suspendedCheck.valid, false);
  assert.match(suspendedCheck.reason || '', /إيقاف/);
  await env.adminPool.query(`UPDATE users SET is_active = true WHERE id = $1`, [user1Id]);

  // 4. مركز معلق (Suspended Tenant)
  await env.adminPool.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenant1Id]);
  const suspendedTenantCheck = await validateSessionState(env.pool, session);
  assert.equal(suspendedTenantCheck.valid, false);
  assert.match(suspendedTenantCheck.reason || '', /موقوف/);
  await env.adminPool.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [tenant1Id]);

  // 5. تغير دور المستخدم في العضوية
  await env.adminPool.query(`UPDATE memberships SET role = 'salon_manager' WHERE tenant_id = $1 AND user_id = $2`, [tenant1Id, user1Id]);
  const roleChangedCheck = await validateSessionState(env.pool, session);
  assert.equal(roleChangedCheck.valid, false);
  assert.match(roleChangedCheck.reason || '', /تغيير دورك/);
});

test('Distributed PostgresRateLimiter enforces rate limiting across shared database', async () => {
  const limiter = new PostgresRateLimiter(env.pool, 3, 5); // 3 محاولات خلال 5 ثوان
  const testIp = '10.0.0.42';

  const r1 = await limiter.check(testIp);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remainingAttempts, 2);

  const r2 = await limiter.check(testIp);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remainingAttempts, 1);

  const r3 = await limiter.check(testIp);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remainingAttempts, 0);

  // المحاولة الرابعة محظورة
  const r4 = await limiter.check(testIp);
  assert.equal(r4.allowed, false);
  assert.ok((r4.retryAfterSeconds || 0) > 0);

  // إعادة الضبط بعد النجاح
  await limiter.reset(testIp);
  const r5 = await limiter.check(testIp);
  assert.equal(r5.allowed, true);
  assert.equal(r5.remainingAttempts, 2);
});

test('Distributed PostgresRateLimiter handles concurrent requests atomically without race condition', async () => {
  const limiter = new PostgresRateLimiter(env.pool, 5, 10);
  const concurrentKey = '192.168.1.99';

  await limiter.reset(concurrentKey);

  // إطلاق 10 طلبات متزامنة في نفس اللحظة بالضبط
  const concurrentPromises = Array.from({ length: 10 }, () => limiter.check(concurrentKey));
  const results = await Promise.all(concurrentPromises);

  // التحقق من أن عدد الطلبات المقبولة هو بالضبط 5 والمحظورة هو 5
  const allowedCount = results.filter(r => r.allowed).length;
  const blockedCount = results.filter(r => !r.allowed).length;

  assert.equal(allowedCount, 5, 'يجب السماح فقط لـ 5 طلبات متزامنة ذرية');
  assert.equal(blockedCount, 5, 'يجب حظر 5 طلبات بعد استنفاد الحد');

  // فحص السجل في قاعدة البيانات والتأكد من تسجيل 10 محاولات دون أخطاء فرادة مفتاح
  const res = await env.adminPool.query(`SELECT attempts FROM auth_rate_limits WHERE key = $1`, [concurrentKey]);
  assert.equal(res.rows[0].attempts, 10, 'إجمالي المحاولات المسجلة يجب أن يكون 10 بالضبط');
});

test('salon_app_role is strictly prohibited from TRUNCATE, schema changes, and role management', async () => {
  // 1. محاولة TRUNCATE بواسطة دور التطبيق المقيد يجب أن تفشل فوراً بحرمان الصلاحية 42501
  await assert.rejects(async () => {
    await env.pool.query('TRUNCATE TABLE customers CASCADE;');
  }, (err: unknown) => {
    const msg = (err as Error).message.toLowerCase();
    return msg.includes('permission denied') || (err as { code?: string }).code === '42501';
  });

  // 2. محاولة DROP TABLE بواسطة دور التطبيق يجب أن تفشل فوراً
  await assert.rejects(async () => {
    await env.pool.query('DROP TABLE customers;');
  }, (err: unknown) => {
    const msg = (err as Error).message.toLowerCase();
    return msg.includes('must be owner') || msg.includes('permission denied') || (err as { code?: string }).code === '42501';
  });

  // 3. محاولة إنشاء أدوار (CREATE ROLE) بواسطة دور التطبيق يجب أن تمنع تماماً
  await assert.rejects(async () => {
    await env.pool.query('CREATE ROLE malicious_test_role;');
  }, (err: unknown) => {
    const msg = (err as Error).message.toLowerCase();
    return msg.includes('permission denied') || (err as { code?: string }).code === '42501';
  });
});

// ==============================================================================
// 4. اختبارات الأمان المتقدم ودوال المصادقة وحماية الأعمدة (Security Hardening & Auth)
// ==============================================================================

test('salon_app_role cannot escalate privilege by updating is_super_admin or subscription_tier', async () => {
  // 1. محاولة تعديل is_super_admin في جدول users بواسطة salon_app_role
  await assert.rejects(async () => {
    await env.pool.query('UPDATE users SET is_super_admin = true WHERE id = $1', [user1Id]);
  }, (err: unknown) => {
    const msg = (err as Error).message.toLowerCase();
    return msg.includes('permission denied') || (err as { code?: string }).code === '42501';
  });

  // 2. محاولة تعديل subscription_tier في جدول tenants بواسطة salon_app_role
  await assert.rejects(async () => {
    await env.pool.query("UPDATE tenants SET subscription_tier = 'enterprise' WHERE id = $1", [tenant1Id]);
  }, (err: unknown) => {
    const msg = (err as Error).message.toLowerCase();
    return msg.includes('permission denied') || (err as { code?: string }).code === '42501';
  });

  // 3. التحقق من أن القيم لم تتغير
  const userCheck = await env.adminPool.query('SELECT is_super_admin FROM users WHERE id = $1', [user1Id]);
  assert.equal(userCheck.rows[0].is_super_admin, false);

  const tenantCheck = await env.adminPool.query('SELECT subscription_tier FROM tenants WHERE id = $1', [tenant1Id]);
  assert.notEqual(tenantCheck.rows[0].subscription_tier, 'enterprise');
});

test('auth_lookup_user_for_login retrieves user safely via SECURITY DEFINER function', async () => {
  // بحث عن مستخدم موجود بحروف كبيرة ومسافات للتأكد من TRIM و LOWER
  const res = await env.pool.query('SELECT * FROM auth_lookup_user_for_login($1)', ['  OWNER1@NARGES.SA  ']);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].email, 'owner1@narges.sa');
  assert.equal(res.rows[0].full_name, 'أميرة العتيبي');
  assert.equal(res.rows[0].is_active, true);
  assert.equal(res.rows[0].is_super_admin, false);
  assert.ok(res.rows[0].password_hash);

  // بحث عن مستخدم غير موجود
  const notFound = await env.pool.query('SELECT * FROM auth_lookup_user_for_login($1)', ['nonexistent@example.com']);
  assert.equal(notFound.rows.length, 0);
});

test('auth_record_login_failure increments attempts and locks out account after 5 tries', async () => {
  // إعادة ضبط المحاولات الفاشلة
  await env.adminPool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user1Id]);

  // 4 محاولات فاشلة
  for (let i = 1; i <= 4; i++) {
    await env.pool.query('SELECT auth_record_login_failure($1)', [user1Id]);
    const check = await env.adminPool.query('SELECT failed_login_attempts, locked_until FROM users WHERE id = $1', [user1Id]);
    assert.equal(check.rows[0].failed_login_attempts, i);
    assert.equal(check.rows[0].locked_until, null);
  }

  // المحاولة الخامسة تؤدي إلى حظر الحساب (lockout)
  await env.pool.query('SELECT auth_record_login_failure($1)', [user1Id]);
  const lockedCheck = await env.adminPool.query('SELECT failed_login_attempts, locked_until FROM users WHERE id = $1', [user1Id]);
  assert.equal(lockedCheck.rows[0].failed_login_attempts, 5);
  assert.ok(lockedCheck.rows[0].locked_until !== null);
  const lockTime = new Date(lockedCheck.rows[0].locked_until).getTime();
  assert.ok(lockTime > Date.now());

  // تسجيل دخول ناجح يعيد تصفير العداد والحظر
  await env.pool.query('SELECT auth_record_login_success($1)', [user1Id]);
  const resetCheck = await env.adminPool.query('SELECT failed_login_attempts, locked_until, last_login_at FROM users WHERE id = $1', [user1Id]);
  assert.equal(resetCheck.rows[0].failed_login_attempts, 0);
  assert.equal(resetCheck.rows[0].locked_until, null);
  assert.ok(resetCheck.rows[0].last_login_at !== null);
});

test('auth_get_user_tenants returns active memberships and salon details', async () => {
  const res = await env.pool.query('SELECT * FROM auth_get_user_tenants($1)', [user1Id]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].tenant_id, tenant1Id);
  assert.equal(res.rows[0].tenant_name, 'صالون النرجس');
  assert.equal(res.rows[0].role, 'salon_owner');
  assert.equal(res.rows[0].membership_active, true);
});

test('bcrypt password hashing and verification enforces minimum length and valid matching', async () => {
  await assert.rejects(async () => {
    await hashPassword('short');
  }, /يجب أن تتكون كلمة المرور من 12 حرفاً على الأقل/);

  const plain = 'VeryStrong!SalonSecret2026';
  const hashed = await hashPassword(plain);
  assert.ok(hashed.startsWith('$2'));

  const valid = await verifyPassword(plain, hashed);
  assert.equal(valid, true);

  const invalid = await verifyPassword('WrongPassword123!', hashed);
  assert.equal(invalid, false);
});



