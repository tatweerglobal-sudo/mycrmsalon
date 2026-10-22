// tests/migration-integrity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Migration 001 exists and defines all required multi-tenant entities', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  assert.ok(fs.existsSync(migrationPath), 'ملف الترقية 001_initial_saas_schema.sql يجب أن يكون موجوداً.');

  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // التحقق من وجود الجداول الأساسية
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
  ];

  for (const table of requiredTables) {
    const tableRegex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i');
    assert.ok(tableRegex.test(sql), `جدول ${table} يجب أن يكون معرّفاً في ملف الترقية.`);
  }
});

test('Migration 001 enforces tenant-scoped customer phone uniqueness', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // التأكد من وجود القيد الفريد على مستوى (tenant_id, phone_normalized)
  assert.ok(
    sql.includes('uq_tenant_customer_phone UNIQUE (tenant_id, phone_normalized)') ||
    sql.includes('UNIQUE (tenant_id, phone_normalized)'),
    'قيد فرادة رقم الهاتف يجب أن يكون محصوراً في نطاق المستأجر الواحد وليس عاماً.'
  );
});

test('Migration 001 enables Row-Level Security (RLS) on all tenant-specific tables', () => {
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
    const rlsRegex = new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, 'i');
    assert.ok(rlsRegex.test(sql), `يجب تفعيل RLS على جدول ${table}.`);

    const policyRegex = new RegExp(`CREATE POLICY.*ON ${table}`, 'i');
    assert.ok(policyRegex.test(sql), `يجب إنشاء سياسة عزل المستأجر لجدول ${table}.`);
  }
});

test('Migration contains no hardcoded credentials or references to outside databases', () => {
  const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_saas_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.equal(sql.includes('somoud'), false);
  assert.equal(sql.includes('crmtatweer'), false);
  assert.equal(sql.includes('recruitment'), false);
  assert.equal(sql.includes('candidate'), false);
});
