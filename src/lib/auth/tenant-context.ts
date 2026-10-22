// src/lib/auth/tenant-context.ts
// استخراج وتنفيذ استعلامات قاعدة البيانات ضمن سياق المستأجر الآمن والمعزول

import type { Pool, PoolClient } from 'pg';
import type { SessionPayload } from './session';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string | null;
  isSuperAdmin: boolean;
}

/**
 * اشتقاق سياق المستأجر من الجلسة الموثقة حصراً
 * يُمنع قبول أي tenantId من المتصفح أو معلمات الطلب
 */
export function getTenantContextFromSession(session: SessionPayload | null): TenantContext {
  if (!session || !session.tenantId || !session.userId) {
    throw new Error('غير مصرح: لا توجد جلسة موثقة نشطة.');
  }

  return {
    tenantId: session.tenantId,
    userId: session.userId,
    role: session.role,
    branchId: session.branchId || null,
    isSuperAdmin: Boolean(session.isSuperAdmin),
  };
}

/**
 * تنفيذ استعلام أو معاملة داخل سياق المستأجر الآمن مع تفعيل RLS
 * يضبط متغير 'app.current_tenant_id' على مستوى المعاملة المحلية فقط
 */
export async function withTenantDb<T>(
  pool: Pool,
  session: SessionPayload,
  fn: (client: PoolClient, context: TenantContext) => Promise<T>
): Promise<T> {
  const context = getTenantContextFromSession(session);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ضبط سياق المستأجر لمعاملة الـ RLS الحالية
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [context.tenantId]);

    const result = await fn(client, context);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
