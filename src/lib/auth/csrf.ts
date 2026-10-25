// src/lib/auth/csrf.ts
// التحقق الصارم من مصدر الطلبات لحماية الواجهات البرمجية من هجمات تزوير الطلبات عبر المواقع (CSRF)
// مع المعالجة الآمنة لترويسات البروكسي العكسي (Reverse Proxy Headers)

import { NextRequest } from 'next/server';

/**
 * تنظيف النطاق من المنافذ القياسية (:80, :443) لمقارنة موثوقة
 */
function normalizeHost(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  // أخذ أول مضيف في حال وجود عدة خوادم وسيطة مفصولة بفواصل
  const primary = hostHeader.split(',')[0].trim().toLowerCase();
  return primary.replace(/:(80|443)$/, '');
}

/**
 * التحقق من تطابق مصدر الطلب (Origin/Referer) مع نطاق الخادم الفعلي،
 * مع مراعاة ترويسات البروكسي العكسي الموثوقة وحظر طلبات المتصفح المريبة
 */
export function validateRequestOrigin(req: NextRequest): { valid: boolean; reason?: string } {
  // 1. فحص ترويسة أمان المتصفح الصريحة Sec-Fetch-Site (SameSite / Cross-Site)
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') {
    return { valid: false, reason: 'Cross-site request blocked by Sec-Fetch-Site policy.' };
  }

  // 2. استخراج المضيف الفعلي عبر ترويسة X-Forwarded-Host أو Host
  const rawExpectedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const expectedHost = normalizeHost(rawExpectedHost);

  if (!expectedHost) {
    return { valid: false, reason: 'Missing Host and X-Forwarded-Host header.' };
  }

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());

  // 3. فحص Origin إن وُجد (الخيار الأساسي لطلبات المتصفح عبر CORS/Fetch/Form)
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const originHost = normalizeHost(originUrl.host);

      if (originHost !== expectedHost) {
        return {
          valid: false,
          reason: `Origin host "${originHost}" does not match server host "${expectedHost}".`,
        };
      }
      return { valid: true };
    } catch (_e) {
      return { valid: false, reason: 'Malformed Origin header format.' };
    }
  }

  // 4. في حال غياب Origin، فحص Referer
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererHost = normalizeHost(refererUrl.host);

      if (refererHost !== expectedHost) {
        return {
          valid: false,
          reason: `Referer host "${refererHost}" does not match server host "${expectedHost}".`,
        };
      }
      return { valid: true };
    } catch (_e) {
      return { valid: false, reason: 'Malformed Referer header format.' };
    }
  }

  // 5. إذا لم يتوفر أي من Origin أو Referer لطلب يغير الحالة (State-changing):
  // فحص ما إذا كان الطلب قادماً من متصفح (وجود كوكي مصادقة أو ترويسات Fetch للمتصفح)
  const isBrowserRequest =
    req.headers.has('sec-fetch-mode') ||
    req.headers.has('sec-fetch-dest') ||
    req.cookies.has('salon_session');

  if (isStateChanging && isBrowserRequest) {
    return {
      valid: false,
      reason: 'State-changing browser requests must include a valid Origin or Referer header.',
    };
  }

  return { valid: true };
}
