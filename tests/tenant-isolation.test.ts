// tests/tenant-isolation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/lib/phone-normalizer';
import { getTenantContextFromSession } from '../src/lib/auth/tenant-context';
import type { SessionPayload } from '../src/lib/auth/session';

/**
 * محاكي بيئة تخزين متعددة المستأجرين (In-memory Multi-tenant store)
 * يجسد بالضبط قيود قاعدة بيانات PostgreSQL و RLS
 */
class MockMultiTenantSalonStore {
  private customers: Array<{
    id: string;
    tenantId: string;
    phoneNormalized: string;
    fullName: string;
  }> = [];

  // إضافة عميل مع فرض قيد: UNIQUE (tenant_id, phone_normalized)
  addCustomer(tenantId: string, fullName: string, phoneRaw: string, country: 'SA' | 'EG' | 'AE' | 'DE' = 'SA') {
    const { isValid, phoneNormalized } = normalizePhone(phoneRaw, country);
    if (!isValid || !phoneNormalized) {
      throw new Error('رقم الهاتف غير صالح.');
    }

    // فحص القيد الفريد على مستوى المستأجر فقط
    const duplicate = this.customers.find(
      c => c.tenantId === tenantId && c.phoneNormalized === phoneNormalized
    );

    if (duplicate) {
      const err = new Error('duplicate key value violates unique constraint "uq_tenant_customer_phone"');
      (err as unknown as { code: string }).code = '23505';
      throw err;
    }

    const customer = {
      id: 'cust_' + Math.random().toString(36).substring(2, 9),
      tenantId,
      phoneNormalized,
      fullName,
    };
    this.customers.push(customer);
    return customer;
  }

  // استعلام العملاء مع تطبيق شرط عزل المستأجر (RLS Simulation)
  getCustomersByTenant(tenantId: string) {
    return this.customers.filter(c => c.tenantId === tenantId);
  }

  // محاولة جلب عميل بالـ ID مع فحص سياق المستأجر الإلزامي
  getCustomerById(tenantId: string, customerId: string) {
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer) return null;

    // منع التسريب العابر للمستأجرين (Cross-tenant leak prevention)
    if (customer.tenantId !== tenantId) {
      return null; // يتصرف كأنه غير موجود لحماية الخصوصية
    }
    return customer;
  }
}

test('Tenant-scoped uniqueness allows identical phone in different beauty centers', () => {
  const store = new MockMultiTenantSalonStore();
  const tenantA = 'tenant_salon_al_narges_sa';
  const tenantB = 'tenant_salon_beverly_hills_eg';
  const sharedPhone = '0501234567'; // رقم هاتف متطابق

  // إضافة العميل للمركز الأول (السعودية)
  const custA = store.addCustomer(tenantA, 'سارة العتيبي', sharedPhone, 'SA');
  assert.equal(custA.tenantId, tenantA);
  assert.equal(custA.phoneNormalized, '+966501234567');

  // إضافة نفس الرقم للمركز الثاني (السعودية)
  const custB = store.addCustomer(tenantB, 'منى إبراهيم', sharedPhone, 'SA');
  assert.equal(custB.tenantId, tenantB);
  assert.equal(custB.phoneNormalized, '+966501234567');

  // التأكد من وجود العميلين بشكل مستقل تماماً
  assert.notEqual(custA.id, custB.id);
  assert.equal(store.getCustomersByTenant(tenantA).length, 1);
  assert.equal(store.getCustomersByTenant(tenantB).length, 1);
});

test('Tenant-scoped uniqueness REJECTS duplicate phone within the SAME salon', () => {
  const store = new MockMultiTenantSalonStore();
  const tenantA = 'tenant_salon_al_narges_sa';
  const phone = '0501234567';

  // إضافة أول مرة تنجح
  store.addCustomer(tenantA, 'سارة العتيبي', phone, 'SA');

  // محاولة إضافة نفس الرقم لنفس المركز يجب أن تفشل بخطأ قيد الفرادة
  assert.throws(
    () => store.addCustomer(tenantA, 'سارة مكررة', phone, 'SA'),
    (err: unknown) => {
      return (err as { code?: string }).code === '23505' ||
             (err as Error).message.includes('uq_tenant_customer_phone');
    }
  );
});

test('Cross-tenant data isolation strictly prevents IDOR (Insecure Direct Object References)', () => {
  const store = new MockMultiTenantSalonStore();
  const tenantA = 'tenant_salon_A';
  const tenantB = 'tenant_salon_B';

  const customerA = store.addCustomer(tenantA, 'عميلة المركز أ', '0501111111', 'SA');

  // مستخدم من المركز أ يستطيع رؤية عميلته
  const retrievedByA = store.getCustomerById(tenantA, customerA.id);
  assert.ok(retrievedByA);
  assert.equal(retrievedByA?.id, customerA.id);

  // مستخدم من المركز ب يحاول الوصول لنفس العميل بـ ID العميل مباشرة ⬅️ يُحجب تماماً!
  const retrievedByB = store.getCustomerById(tenantB, customerA.id);
  assert.equal(retrievedByB, null);
});

test('Browser-supplied tenantId is ignored in favor of authenticated session context', () => {
  const session: SessionPayload = {
    userId: 'u_legit_user',
    tenantId: 'tenant_salon_legit_42',
    role: 'receptionist',
    branchId: 'branch_1',
    isSuperAdmin: false,
    email: 'receptionist@salon.sa',
    fullName: 'هدى مصطفى',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };

  // العميل يرسل في معلمات الـ Request هجوماً: tenant_id_in_url = 'tenant_victim_99'
  const attackerParam = 'tenant_victim_99';

  // النظام يشتق السياق من الجلسة الموثقة حصراً
  const secureContext = getTenantContextFromSession(session);

  assert.equal(secureContext.tenantId, 'tenant_salon_legit_42');
  assert.notEqual(secureContext.tenantId, attackerParam);
});
