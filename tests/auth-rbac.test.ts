// tests/auth-rbac.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  canAccessBranch,
  type SalonRole,
} from '../src/lib/auth/roles';
import {
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from '../src/lib/auth/session';
import { MemoryRateLimiter } from '../src/lib/auth/rate-limiter';
import { getTenantContextFromSession } from '../src/lib/auth/tenant-context';

test('Super Admin has full platform and tenant management permissions', () => {
  assert.equal(hasPermission('saas_super_admin', 'tenant:manage'), true);
  assert.equal(hasPermission('saas_super_admin', 'financials:view'), true);
  assert.equal(hasPermission('saas_super_admin', 'services:manage'), true);
});

test('Salon Owner has full salon permissions but not platform super-admin', () => {
  assert.equal(hasPermission('salon_owner', 'tenant:settings'), true);
  assert.equal(hasPermission('salon_owner', 'financials:view'), true);
  assert.equal(hasPermission('salon_owner', 'staff:manage'), true);
  assert.equal(hasPermission('salon_owner', 'tenant:manage'), false); // فقط للـ Super Admin
});

test('Receptionist can manage appointments and customers but cannot access financials or salon settings', () => {
  assert.equal(hasPermission('receptionist', 'customers:view'), true);
  assert.equal(hasPermission('receptionist', 'customers:manage'), true);
  assert.equal(hasPermission('receptionist', 'appointments:manage'), true);
  assert.equal(hasPermission('receptionist', 'financials:view'), false);
  assert.equal(hasPermission('receptionist', 'tenant:settings'), false);
  assert.equal(hasPermission('receptionist', 'services:manage'), false);
});

test('Beauty Specialist can only view own appointments and customers, no financials or salon settings', () => {
  assert.equal(hasPermission('beauty_specialist', 'customers:view'), true);
  assert.equal(hasPermission('beauty_specialist', 'appointments:view_own'), true);
  assert.equal(hasPermission('beauty_specialist', 'appointments:view_all'), false);
  assert.equal(hasPermission('beauty_specialist', 'appointments:manage'), false);
  assert.equal(hasPermission('beauty_specialist', 'financials:view'), false);
  assert.equal(hasPermission('beauty_specialist', 'services:manage'), false);
});

test('Accountant can view financials, invoices, and appointments but cannot edit services or customers', () => {
  assert.equal(hasPermission('accountant', 'financials:view'), true);
  assert.equal(hasPermission('accountant', 'invoices:manage'), true);
  assert.equal(hasPermission('accountant', 'customers:view'), true);
  assert.equal(hasPermission('accountant', 'customers:manage'), false);
  assert.equal(hasPermission('accountant', 'services:manage'), false);
});

test('Branch access rules enforce strict isolation for non-owners', () => {
  const branch1 = 'b1111111-1111-1111-1111-111111111111';
  const branch2 = 'b2222222-2222-2222-2222-222222222222';

  // المالك والسوبر أدمن يمكنهما الوصول لأي فرع
  assert.equal(canAccessBranch('salon_owner', branch1, branch2), true);
  assert.equal(canAccessBranch('saas_super_admin', null, branch1), true);

  // موظف الاستقبال مخصص لفرع 1 فقط
  assert.equal(canAccessBranch('receptionist', branch1, branch1), true);
  assert.equal(canAccessBranch('receptionist', branch1, branch2), false);

  // مستخدم بدون فرع مخصص يتم رفضه إذا لم يكن مالكاً
  assert.equal(canAccessBranch('receptionist', null, branch1), false);
});

test('Session token creation, verification, and tamper resistance', () => {
  const mockPayload: Omit<SessionPayload, 'issuedAt' | 'expiresAt'> = {
    userId: 'u1111111-1111-1111-1111-111111111111',
    tenantId: 't1111111-1111-1111-1111-111111111111',
    role: 'salon_owner' as SalonRole,
    branchId: null,
    isSuperAdmin: false,
    email: 'owner@salon.sa',
    fullName: 'نورة العتيبي',
  };

  const token = createSessionToken(mockPayload);
  assert.ok(token.includes('.'));

  // التحقق الصحيح
  const verified = verifySessionToken(token);
  assert.ok(verified);
  assert.equal(verified?.userId, mockPayload.userId);
  assert.equal(verified?.tenantId, mockPayload.tenantId);
  assert.equal(verified?.role, 'salon_owner');

  // رفض التوكن المتلاعب به
  const parts = token.split('.');
  const tamperedToken = parts[0] + '.invalid_signature_here';
  assert.equal(verifySessionToken(tamperedToken), null);

  // رفض التوكن المنتهي الصلاحية (-1000 ms)
  const expiredToken = createSessionToken(mockPayload, -1000);
  assert.equal(verifySessionToken(expiredToken), null);
});

test('Rate limiter blocks after maximum attempts and allows after reset', () => {
  const limiter = new MemoryRateLimiter(3, 5000);
  const testKey = 'ip_192.168.1.1';

  assert.equal(limiter.check(testKey).allowed, true);
  assert.equal(limiter.check(testKey).allowed, true);
  assert.equal(limiter.check(testKey).allowed, true);

  // المحاولة الرابعة يجب أن تُحظر
  const fourth = limiter.check(testKey);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remainingAttempts, 0);
  assert.ok((fourth.retryAfterSeconds || 0) > 0);

  // إعادة الضبط بعد تسجيل دخول ناجح
  limiter.reset(testKey);
  assert.equal(limiter.check(testKey).allowed, true);
});

test('Tenant context strictly rejects null or missing session', () => {
  assert.throws(() => getTenantContextFromSession(null), /غير مصرح/);
  // @ts-expect-error اختبار تمرير جلسة ناقصة
  assert.throws(() => getTenantContextFromSession({ userId: 'u1' }), /غير مصرح/);
});
