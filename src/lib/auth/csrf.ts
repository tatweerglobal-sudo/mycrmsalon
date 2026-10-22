// src/lib/auth/csrf.ts
// التحقق من مصدر الطلبات لحماية الواجهات البرمجية من هجمات تزوير الطلبات عبر المواقع (CSRF)

import { NextRequest } from 'next/server';

/**
 * التحقق من تطابق مصدر الطلب (Origin/Referer) مع نطاق الخادم الفعلي
 */
export function validateRequestOrigin(req: NextRequest): { valid: boolean; reason?: string } {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');

  // إذا لم يتوفر Origin (مثل طلبات البرمجة المباشرة عبر curl أو خوادم الـ API الداخلية)
  if (!origin) {
    const referer = req.headers.get('referer');
    if (!referer) {
      // السماح بطلبات الخادم الداخلية أو الأدوات المباشرة، مع تسجيل ذلك
      return { valid: true };
    }
    try {
      const refererUrl = new URL(referer);
      if (host && refererUrl.host !== host) {
        return { valid: false, reason: 'Referer header does not match Host.' };
      }
      return { valid: true };
    } catch (_e) {
      return { valid: false, reason: 'Invalid Referer header format.' };
    }
  }

  try {
    const originUrl = new URL(origin);
    if (!host) {
      return { valid: false, reason: 'Missing Host header.' };
    }

    if (originUrl.host !== host) {
      return { valid: false, reason: `Origin ${originUrl.host} does not match Host ${host}.` };
    }

    return { valid: true };
  } catch (_e) {
    return { valid: false, reason: 'Invalid Origin header format.' };
  }
}
