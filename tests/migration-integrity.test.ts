// tests/migration-integrity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Migration 001 exists and defines all required multi-tenant entities', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  assert.ok(fs.existsSync(migrationPath), 'ملف الترقية 001_initial_saas_schema.sql يجب أن يكون موجوداً.');

  const sql = fs.readFileSync(migrationPath, 'utf-8');

  const requiredTables = [
    'tenants',
    'branches',
    'users',
    'memberships',
    'salon_staff',
    'customers',
    'service_categories',
    'services',
    'staff_services',
    'appointments',
    'appointment_services',
    'audit_logs',
    'auth_rate_limits',
  ];

  for (const table of requiredTables) {
    const tableRegex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i');
    assert.ok(tableRegex.test(sql), `جدول ${table} يجب أن يكون معرّفاً في ملف الترقية.`);
  }
});

test('Migration 001 enforces tenant-scoped customer phone uniqueness', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.ok(
    sql.includes('uq_tenant_customer_phone UNIQUE (tenant_id, phone_normalized)') ||
    sql.includes('UNIQUE (tenant_id, phone_normalized)'),
    'قيد فرادة رقم الهاتف يجب أن يكون محصوراً في نطاق المستأجر الواحد وليس عاماً.'
  );
});

test('Migration 001 enables and FORCES Row-Level Security (RLS) on all tenant-specific tables', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  const rlsTables = [
    'branches',
    'memberships',
    'salon_staff',
    'customers',
    'service_categories',
    'services',
    'staff_services',
    'appointments',
    'appointment_services',
    'audit_logs',
  ];

  for (const table of rlsTables) {
    const rlsEnable = new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, 'i');
    const rlsForce = new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`, 'i');
    assert.ok(rlsEnable.test(sql), `يجب تفعيل ENABLE RLS على جدول ${table}.`);
    assert.ok(rlsForce.test(sql), `يجب فرض FORCE RLS على جدول ${table}.`);

    const policyRegex = new RegExp(`CREATE POLICY.*ON ${table}`, 'i');
    assert.ok(policyRegex.test(sql), `يجب إنشاء سياسة عزل المستأجر لجدول ${table}.`);
  }
});

test('Migration 001 establishes tenant-consistent composite foreign keys', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.ok(sql.includes('uq_branches_tenant_id UNIQUE (tenant_id, id)'));
  assert.ok(sql.includes('uq_customers_tenant_id UNIQUE (tenant_id, id)'));
  assert.ok(sql.includes('fk_apt_tenant_customer FOREIGN KEY (tenant_id, customer_id)'));
  assert.ok(sql.includes('fk_apt_tenant_branch FOREIGN KEY (tenant_id, branch_id)'));
  assert.ok(sql.includes('fk_staff_tenant_branch FOREIGN KEY (tenant_id, branch_id)'));
});

test('Migration 001 configures dedicated non-bypassable runtime role with least privilege', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.ok(sql.includes('salon_app_role'));
  assert.ok(sql.includes('WITH LOGIN'));
  assert.ok(sql.includes('NOBYPASSRLS'));
  assert.ok(sql.includes('NOSUPERUSER'));
  assert.ok(sql.includes('NOCREATEROLE'));
  assert.ok(sql.includes('REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM salon_app_role'));
  assert.ok(sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES'));
  assert.equal(sql.includes('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO salon_app_role'), false);
});

test('Migration contains no hardcoded credentials or references to outside databases', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.equal(sql.includes('somoud'), false);
  assert.equal(sql.includes('crmtatweer'), false);
  assert.equal(sql.includes('recruitment'), false);
  assert.equal(sql.includes('candidate'), false);
  // تأكيد صارم على خلو ملف الترقية من أي كلمات مرور
  assert.equal(sql.includes('salon_app_secret_test_pass'), false);
  assert.equal(/PASSWORD\s+'[^']+'/i.test(sql), false);
});

test('Migration 002 enforces security hardening on tenants, users, and auth functions', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '002_security_hardening.sql');
  assert.ok(fs.existsSync(migrationPath), 'ملف الترقية 002_security_hardening.sql يجب أن يكون موجوداً.');

  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // التحقق من FORCE RLS على tenants و users
  assert.ok(sql.includes('ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes('ALTER TABLE tenants FORCE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes('ALTER TABLE users ENABLE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes('ALTER TABLE users FORCE ROW LEVEL SECURITY;'));

  // التحقق من سياسات العزل
  assert.ok(sql.includes('tenant_isolation_tenants_select'));
  assert.ok(sql.includes('user_isolation_select'));

  // التحقق من تقييد الأعمدة
  assert.ok(sql.includes('GRANT UPDATE (name, timezone, currency'));
  assert.ok(sql.includes('auth_lookup_user_for_login'));
  assert.ok(sql.includes('auth_get_user_tenants'));
});

