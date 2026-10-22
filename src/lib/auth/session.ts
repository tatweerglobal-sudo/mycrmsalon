// src/lib/auth/session.ts
// إدارة جلسات المستخدمين وتوقيع التوكنات المشفرة مع التحقق الآمن

import crypto from 'node:crypto';
import type { SalonRole } from './roles';

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: SalonRole;
  branchId?: string | null;
  isSuperAdmin?: boolean;
  email: string;
  fullName: string;
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
    // مفتاح احتياطي مشتق للبيئة المحلية والاختبارات فقط
    return 'salon_dev_test_session_secret_key_minimum_32_chars_ok';
  }
  return secret;
}

/**
 * إنشاء توكن جلسة موقع ومحمي ضد التلاعب (HMAC-SHA256)
 */
export function createSessionToken(
  payload: Omit<SessionPayload, 'issuedAt' | 'expiresAt'>,
  durationMs = DEFAULT_SESSION_DURATION_MS
): string {
  const now = Date.now();
  const fullPayload: SessionPayload = {
    ...payload,
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
    return null; // التوقيع غير مطابق أو تم التلاعب به
  }

  try {
    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const payload: SessionPayload = JSON.parse(jsonStr);

    // التحقق من انتهاء الصلاحية
    if (Date.now() > payload.expiresAt) {
      return null; // الجلسة منتهية
    }

    // التحقق من الحقول الأساسية
    if (!payload.userId || !payload.tenantId || !payload.role) {
      return null;
    }

    return payload;
  } catch (_e) {
    return null;
  }
}

/**
 * خصائص الكوكي الآمن المتوافق مع معايير OWASP
 */
export const SESSION_COOKIE_OPTIONS = {
  name: 'salon_session',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: DEFAULT_SESSION_DURATION_MS / 1000,
};
