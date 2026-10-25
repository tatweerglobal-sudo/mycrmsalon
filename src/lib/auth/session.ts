// src/lib/auth/session.ts
// إدارة جلسات المستخدمين وتوقيع التوكنات المشفرة مع التحقق والتحكم بالإبطال

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { SalonRole } from './roles';

/**
 * بنية بيانات الجلسة (Signed Session Payload)
 *
 * ملاحظة أمنية معمارية هامة (Security Note):
 * هذا التوكن هو توكن موقّع مشفّر التوقيع (HMAC-SHA256 Signed Token).
 * - الحمولة (Payload) مشفرة بتنسيق Base64URL وهي مقروءة للطرفين،
 *   لذلك يُمنع وضع بيانات سرية أو كلمات مرور داخلها.
 * - التوقيع (Signature) يضمن عدم إمكانية تعديل أي حقل (مثل userId أو tenantId أو role)
 *   دون كشف التلاعب فوراً ورفض التوكن.
 */
export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: SalonRole;
  branchId?: string | null;
  isSuperAdmin?: boolean;
  email: string;
  fullName: string;
  tokenVersion?: number; // إصدار التوكن لدعم الإبطال الفوري (Session Revocation)
  issuedAt: number; // Unix timestamp ms
  expiresAt: number; // Unix timestamp ms
}

const DEFAULT_SESSION_DURATION_MS = 1000 * 60 * 60 * 12; // 12 ساعة

function getSessionSecret(): string {
  const secret = process.env.SALON_SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SALON_SESSION_SECRET must be configured in production.');
    }
    return 'salon_dev_test_session_secret_key_minimum_32_chars_ok';
  }
  return secret;
}

/**
 * إنشاء توكن جلسة موقّع ومحمي ضد التلاعب (HMAC-SHA256)
 */
export function createSessionToken(
  payload: Omit<SessionPayload, 'issuedAt' | 'expiresAt'>,
  durationMs = DEFAULT_SESSION_DURATION_MS
): string {
  const now = Date.now();
  const fullPayload: SessionPayload = {
    ...payload,
    tokenVersion: payload.tokenVersion ?? 1,
    issuedAt: now,
    expiresAt: now + durationMs,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * التحقق من توكن الجلسة واستخراج البيانات بعد التأكد من التوقيع والصلاحية
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadBase64)
    .digest('base64url');

  // حماية من هجمات Timing Attacks باستخدام timingSafeEqual
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const payload: SessionPayload = JSON.parse(jsonStr);

    if (Date.now() > payload.expiresAt) {
      return null;
    }

    if (!payload.userId || !payload.tenantId || !payload.role) {
      return null;
    }

    return payload;
  } catch (_e) {
    return null;
  }
}

/**
 * التحقق المباشر من قاعدة البيانات لحالة الجلسة الحية (Stateful Verification)
 * يفحص:
 * 1. المستخدم غير محظور أو موقوف
 * 2. عدم إبطال التوكنات السابقة عبر فحص token_version
 * 3. عضوية المستأجر لا تزال نشطة والدور لم يتغير (ضمن سياق المستأجر لـ RLS)
 * 4. مركز التجميل (Tenant) غير معلق
 */
export async function validateSessionState(
  pool: Pool,
  session: SessionPayload
): Promise<{ valid: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ضبط سياق الجلسة للمستخدم والمستأجر لضمان عمل RLS على جداول users و tenants و memberships
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_tenant_id', $2, true)",
      [session.userId, session.tenantId]
    );

    // 1. فحص المستخدم وإصدار التوكن وقفل الحساب
    const userRes = await client.query(
      `SELECT is_active, locked_until, token_version FROM users WHERE id = $1`,
      [session.userId]
    );

    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'المستخدم غير موجود' };
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'تم إيقاف حساب المستخدم' };
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'الحساب مغلق مؤقتاً بسبب محاولات متكررة' };
    }

    if (session.tokenVersion !== undefined && user.token_version !== session.tokenVersion) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'تم إبطال هذه الجلسة، يرجى تسجيل الدخول مجدداً' };
    }

    if (session.isSuperAdmin) {
      await client.query('COMMIT');
      return { valid: true };
    }

    // 2. فحص حالة مركز التجميل (Tenant)
    const tenantRes = await client.query(
      `SELECT status FROM tenants WHERE id = $1`,
      [session.tenantId]
    );

    if (tenantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'مركز التجميل غير موجود' };
    }

    const tenant = tenantRes.rows[0];
    if (tenant.status === 'suspended' || tenant.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'اشتراك مركز التجميل موقوف أو معلق' };
    }

    // 3. ضبط سياق المستأجر قبل استعلام جدول memberships الخاضع لـ RLS
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [session.tenantId]);

    const membershipRes = await client.query(
      `SELECT role, is_active FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [session.tenantId, session.userId]
    );

    if (membershipRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'لم تعد عضواً في هذا المركز' };
    }

    const membership = membershipRes.rows[0];
    if (!membership.is_active) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'تم تعطيل صلاحية وصولك لهذا المركز' };
    }

    if (membership.role !== session.role) {
      await client.query('ROLLBACK');
      return { valid: false, reason: 'تم تغيير دورك الوظيفي، يرجى تجديد الجلسة' };
    }

    await client.query('COMMIT');
    return { valid: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * إبطال كافة الجلسات الحالية للمستخدم فورياً عبر رفع token_version
 */
export async function revokeAllUserSessions(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

/**
 * خصائص الكوكي الآمن
 */
export const SESSION_COOKIE_OPTIONS = {
  name: 'salon_session',
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: DEFAULT_SESSION_DURATION_MS / 1000,
};

/**
 * استخراج جلسة المستخدم الموثقة من الطلب مع دعم الكوكي، ترويسة Authorization Bearer، وترويسة x-session-token، ومعلمة الرابط st
 */
export function getSessionFromRequest(req: {
  cookies: { get: (name: string) => { value: string } | undefined };
  headers: { get: (name: string) => string | null };
  nextUrl?: { searchParams: { get: (name: string) => string | null } };
}): SessionPayload | null {
  const cookie = req.cookies.get('salon_session')?.value;
  if (cookie) {
    const s = verifySessionToken(cookie);
    if (s) return s;
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const s = verifySessionToken(token);
    if (s) return s;
  }
  const headerToken = req.headers.get('x-session-token');
  if (headerToken) {
    const s = verifySessionToken(headerToken);
    if (s) return s;
  }
  const tokenParam = req.nextUrl?.searchParams?.get('st');
  if (tokenParam) {
    const s = verifySessionToken(tokenParam);
    if (s) return s;
  }
  return null;
}
