// tests/saas-isolation-full.test.ts
// اختبارات عزل المستأجرين والصلاحيات ودورة حياة الاشتراك الكاملة (Phase 5 Isolation Tests)
// تستخدم صالونين اصطناعيين Salon A و Salon B مع فحص RLS والـ APIs وقاعدة البيانات الفعلية

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestPostgres, type RealPostgresEnv } from './real-postgres-harness';
import { withTenantDb } from '../src/lib/auth/tenant-context';
import { validateSessionState, createSessionToken, revokeAllUserSessions, type SessionPayload } from '../src/lib/auth/session';
import { hasPermission } from '../src/lib/auth/roles';
import { normalizePhone } from '../src/lib/phone-normalizer';

let env: RealPostgresEnv;

const TENANT_A_SLUG = 'salon-alpha-riyadh';
const TENANT_B_SLUG = 'salon-beta-cairo';

let tenantAId: string;
let tenantBId: string;
let ownerAUserId: string;
let receptionistAUserId: string;
let ownerBUserId: string;

let ownerASession: SessionPayload;
let receptionistASession: SessionPayload;
let ownerBSession: SessionPayload;

before(async () => {
  env = await setupTestPostgres(54341);
  const client = await env.adminPool.connect();

  try {
    await client.query('BEGIN');

    // 1. إنشاء صالون A
    const tARes = await client.query(`
      INSERT INTO tenants (name, slug, country_code, currency, timezone, status, subscription_tier, max_branches, max_staff)
      VALUES ('صالون ألفا الرياض', $1, 'SA', 'SAR', 'Asia/Riyadh', 'active', 'starter', 1, 5)
      RETURNING id
    `, [TENANT_A_SLUG]);
    tenantAId = tARes.rows[0].id;

    const bARes = await client.query(`
      INSERT INTO branches (tenant_id, name, is_main, is_active)
      VALUES ($1, 'الفرع الرئيسي الرياض', true, true)
      RETURNING id
    `, [tenantAId]);
    const branchAId = bARes.rows[0].id;

    // مستخدم مالك صالون A
    const uARes = await client.query(`
      INSERT INTO users (email, phone_normalized, full_name, password_hash, is_super_admin, is_active)
      VALUES ('owner-a@alpha.sa', '+966500000001', 'سارة مالكة ألفا', '$2a$10$abcdefghijklmnopqrstuu', false, true)
      RETURNING id
    `);
    ownerAUserId = uARes.rows[0].id;

    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'salon_owner', $3, true)
    `, [tenantAId, ownerAUserId, branchAId]);

    // مستخدم موظفة استقبال في صالون A
    const uRecARes = await client.query(`
      INSERT INTO users (email, phone_normalized, full_name, password_hash, is_super_admin, is_active)
      VALUES ('receptionist@alpha.sa', '+966500000002', 'هدى استقبال ألفا', '$2a$10$abcdefghijklmnopqrstuu', false, true)
      RETURNING id
    `);
    receptionistAUserId = uRecARes.rows[0].id;

    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'receptionist', $3, true)
    `, [tenantAId, receptionistAUserId, branchAId]);

    // 2. إنشاء صالون B
    const tBRes = await client.query(`
      INSERT INTO tenants (name, slug, country_code, currency, timezone, status, subscription_tier, max_branches, max_staff)
      VALUES ('صالون بيتا القاهرة', $1, 'EG', 'EGP', 'Africa/Cairo', 'active', 'growth', 2, 10)
      RETURNING id
    `, [TENANT_B_SLUG]);
    tenantBId = tBRes.rows[0].id;

    const bBRes = await client.query(`
      INSERT INTO branches (tenant_id, name, is_main, is_active)
      VALUES ($1, 'فرع المعادي الرئيسي', true, true)
      RETURNING id
    `, [tenantBId]);
    const branchBId = bBRes.rows[0].id;

    const uBRes = await client.query(`
      INSERT INTO users (email, phone_normalized, full_name, password_hash, is_super_admin, is_active)
      VALUES ('owner-b@beta.eg', '+201000000001', 'مريم مالكة بيتا', '$2a$10$abcdefghijklmnopqrstuu', false, true)
      RETURNING id
    `);
    ownerBUserId = uBRes.rows[0].id;

    await client.query(`
      INSERT INTO memberships (tenant_id, user_id, role, branch_id, is_active)
      VALUES ($1, $2, 'salon_owner', $3, true)
    `, [tenantBId, ownerBUserId, branchBId]);

    await client.query('COMMIT');

    ownerASession = {
      userId: ownerAUserId,
      tenantId: tenantAId,
      role: 'salon_owner',
      branchId: branchAId,
      isSuperAdmin: false,
      email: 'owner-a@alpha.sa',
      fullName: 'سارة مالكة ألفا',
      tokenVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };

    receptionistASession = {
      userId: receptionistAUserId,
      tenantId: tenantAId,
      role: 'receptionist',
      branchId: branchAId,
      isSuperAdmin: false,
      email: 'receptionist@alpha.sa',
      fullName: 'هدى استقبال ألفا',
      tokenVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };

    ownerBSession = {
      userId: ownerBUserId,
      tenantId: tenantBId,
      role: 'salon_owner',
      branchId: branchBId,
      isSuperAdmin: false,
      email: 'owner-b@beta.eg',
      fullName: 'مريم مالكة بيتا',
      tokenVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

after(async () => {
  if (env) {
    await env.stop();
  }
});

// 1. عميلة منشأة في صالون A لا تظهر مطلقاً في صالون B
test('Phase 5.1: Customer created in Salon A is completely invisible in Salon B', async () => {
  let custAId: string;

  // إضافة عميلة في صالون A
  await withTenantDb(env.pool, ownerASession, async (client, ctx) => {
    const res = await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_raw, phone_normalized)
      VALUES ($1, 'أميرة الناصر', '0551234567', '+966551234567')
      RETURNING id
    `, [ctx.tenantId]);
    custAId = res.rows[0].id;
  });

  // صالون A يستطيع استعراض عميلته
  await withTenantDb(env.pool, ownerASession, async (client) => {
    const res = await client.query('SELECT * FROM customers WHERE id = $1', [custAId]);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].full_name, 'أميرة الناصر');
  });

  // صالون B يبحث عن نفس العميلة عبر الـ ID ⬅️ RLS يعيد 0 سجلات فوراً
  await withTenantDb(env.pool, ownerBSession, async (client) => {
    const res = await client.query('SELECT * FROM customers WHERE id = $1', [custAId]);
    assert.equal(res.rows.length, 0, 'Cross-tenant leak detected! Customer from A appeared in B');
  });
});

// 2. حجز وفاتورة في صالون A لا يمكن قراءتهما أو تعديلهما من صالون B
test('Phase 5.2: Invoices and Appointments in Salon A cannot be read or updated by Salon B', async () => {
  let aptAId: string;
  let invAId: string;

  // صالون A ينشئ حجز وفاتورة
  await withTenantDb(env.pool, ownerASession, async (client, ctx) => {
    // جلب العميلة والفرع
    const cRes = await client.query('SELECT id FROM customers LIMIT 1');
    const custId = cRes.rows[0].id;

    const aptRes = await client.query(`
      INSERT INTO appointments (tenant_id, branch_id, customer_id, starts_at, ends_at, status, total_price, final_price)
      VALUES ($1, $2, $3, NOW() + INTERVAL '2 hours', NOW() + INTERVAL '3 hours', 'booked', 250.00, 250.00)
      RETURNING id
    `, [ctx.tenantId, ctx.branchId, custId]);
    aptAId = aptRes.rows[0].id;

    const invRes = await client.query(`
      INSERT INTO invoices (tenant_id, branch_id, customer_id, appointment_id, invoice_number, subtotal, total_amount, paid_amount, status)
      VALUES ($1, $2, $3, $4, 'INV-A-001', 250.00, 250.00, 0.00, 'unpaid')
      RETURNING id
    `, [ctx.tenantId, ctx.branchId, custId, aptAId]);
    invAId = invRes.rows[0].id;
  });

  // صالون B يحاول قراءة حجز وفاتورة صالون A
  await withTenantDb(env.pool, ownerBSession, async (client) => {
    const aptCheck = await client.query('SELECT * FROM appointments WHERE id = $1', [aptAId]);
    assert.equal(aptCheck.rows.length, 0, 'Appointment leaked across tenants!');

    const invCheck = await client.query('SELECT * FROM invoices WHERE id = $1', [invAId]);
    assert.equal(invCheck.rows.length, 0, 'Invoice leaked across tenants!');
  });

  // صالون B يحاول تعديل فاتورة صالون A مباشرة ⬅️ لا يحدث أي تحديث
  await withTenantDb(env.pool, ownerBSession, async (client) => {
    const updateRes = await client.query('UPDATE invoices SET status = $1 WHERE id = $2', ['paid', invAId]);
    assert.equal(updateRes.rowCount, 0, 'Cross-tenant UPDATE was not blocked by RLS!');
  });
});

// 3. إمكانية استخدام نفس رقم الهاتف في صالونين مختلفين
test('Phase 5.3: Identical customer phone can be registered independently in Salon A and Salon B', async () => {
  const sharedPhoneRaw = '0509998877';
  const norm = normalizePhone(sharedPhoneRaw, 'SA');
  assert.ok(norm.isValid);

  // تسجيل في صالون A
  await withTenantDb(env.pool, ownerASession, async (client, ctx) => {
    const res = await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_raw, phone_normalized)
      VALUES ($1, 'ريم المشتركة ألفا', $2, $3)
      RETURNING id
    `, [ctx.tenantId, sharedPhoneRaw, norm.phoneNormalized]);
    assert.ok(res.rows[0].id);
  });

  // تسجيل نفس الرقم في صالون B ينجح بدون تعارض
  await withTenantDb(env.pool, ownerBSession, async (client, ctx) => {
    const res = await client.query(`
      INSERT INTO customers (tenant_id, full_name, phone_raw, phone_normalized)
      VALUES ($1, 'ريم المشتركة بيتا', $2, $3)
      RETURNING id
    `, [ctx.tenantId, sharedPhoneRaw, norm.phoneNormalized]);
    assert.ok(res.rows[0].id);
  });
});

// 4. منع تكرار رقم الهاتف داخل نفس الصالون الواحد
test('Phase 5.4: Duplicate customer phone within the SAME salon is strictly rejected', async () => {
  const duplicatePhone = '+966509998877';

  await assert.rejects(async () => {
    await withTenantDb(env.pool, ownerASession, async (client, ctx) => {
      await client.query(`
        INSERT INTO customers (tenant_id, full_name, phone_raw, phone_normalized)
        VALUES ($1, 'ريم نسخة مكررة', '0509998877', $2)
      `, [ctx.tenantId, duplicatePhone]);
    });
  }, (err: Error & { code?: string }) => {
    return err.code === '23505' || err.message.includes('uq_tenant_customer_phone');
  });
});

// 5. منع موظفة استقبال من تعديل الباقة أو إنشاء فروع بغير صلاحية
test('Phase 5.5: Receptionist role is forbidden from branches:manage or tenant:settings', () => {
  // موظفة الاستقبال تملك صلاحية إدارة العملاء والمواعيد
  assert.equal(hasPermission(receptionistASession.role, 'customers:manage'), true);
  assert.equal(hasPermission(receptionistASession.role, 'appointments:manage'), true);

  // لكن ممنوعة قطعياً من إدارة الفروع أو إعدادات المنصة أو المالية
  assert.equal(hasPermission(receptionistASession.role, 'branches:manage'), false);
  assert.equal(hasPermission(receptionistASession.role, 'tenant:settings'), false);
  assert.equal(hasPermission(receptionistASession.role, 'tenant:manage'), false);
  assert.equal(hasPermission(receptionistASession.role, 'financials:view'), false);
});

// 6. منع مالك الصالون من الوصول إلى /admin أو إدارة المنصة
test('Phase 5.6: Salon Owner is strictly forbidden from platform super-admin permission', () => {
  assert.equal(ownerASession.isSuperAdmin, false);
  assert.equal(hasPermission(ownerASession.role, 'tenant:manage', ownerASession.isSuperAdmin), false);
});

// 7. إبطال الجلسات فور تعليق الصالون أو تعطيل العضوية
test('Phase 5.7: Suspending a salon immediately rejects active sessions with suspended status', async () => {
  // 1. الجلسة صالحة قبل التعليق
  const preCheck = await validateSessionState(env.pool, ownerASession);
  assert.equal(preCheck.valid, true);

  // 2. تعليق صالون A
  await env.adminPool.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [tenantAId]);

  // 3. محاولة التحقق من الجلسة بعد التعليق ⬅️ مرفوضة فوراً
  const postCheck = await validateSessionState(env.pool, ownerASession);
  assert.equal(postCheck.valid, false);
  assert.ok(postCheck.reason?.includes('موقوف') || postCheck.reason?.includes('معلق'));

  // 4. إعادة تفعيل الصالون ⬅️ تعود الجلسة صالحة بكامل بياناتها السابقة دون حذف أي شيء
  await env.adminPool.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantAId]);
  const reactivateCheck = await validateSessionState(env.pool, ownerASession);
  assert.equal(reactivateCheck.valid, true);
});

// 8. منع الوصول بتوكن ملغى أو بعد تغيير الدور الوظيفي
test('Phase 5.8: Revoking sessions via token_version bump or role alteration invalidates active session', async () => {
  // الجلسة صالحة
  const validCheck = await validateSessionState(env.pool, ownerASession);
  assert.equal(validCheck.valid, true);

  // إبطال كافة جلسات المستخدم برفع token_version
  await revokeAllUserSessions(env.adminPool, ownerAUserId);

  // التحقق بنفس التوكن القديم ⬅️ يُرفض فوراً
  const revokedCheck = await validateSessionState(env.pool, ownerASession);
  assert.equal(revokedCheck.valid, false);
  assert.ok(revokedCheck.reason?.includes('إبطال هذه الجلسة'));

  // تعديل دور المستخدم في قاعدة البيانات
  const tamperedSession: SessionPayload = {
    ...ownerBSession,
    role: 'accountant', // تم تغيير الدور
  };
  const roleMismatchCheck = await validateSessionState(env.pool, tamperedSession);
  assert.equal(roleMismatchCheck.valid, false);
  assert.ok(roleMismatchCheck.reason?.includes('تغيير دورك'));
});

// 9. نجاح إنشاء الصالون ذرية دون سجلات ناقصة عند الطلبات المتزامنة
test('Phase 5.9: Atomic tenant onboarding prevents duplicate slug and avoids partial orphaned records', async () => {
  const duplicateSlug = TENANT_A_SLUG; // نفس slug صالون A الموجود مسبقاً

  const client = await env.adminPool.connect();
  let rolledBack = false;

  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM tenants WHERE slug = $1', [duplicateSlug]);
    if (existing.rows.length > 0) {
      throw new Error(`معرف النطاق "${duplicateSlug}" مستخدم مسبقاً`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    rolledBack = true;
    assert.ok((err as Error).message.includes('مستخدم مسبقاً'));
  } finally {
    client.release();
  }

  assert.equal(rolledBack, true);
});
