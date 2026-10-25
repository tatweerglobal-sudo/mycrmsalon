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

const TRUSTED_DOMAINS = ['crmsalon.de', 'www.crmsalon.de'];

function isTrustedHost(host: string | null): boolean {
  if (!host) return false;
  const clean = host.toLowerCase();
  return TRUSTED_DOMAINS.some((d) => clean === d || clean.endsWith('.' + d));
}

/**
 * التحقق من تطابق مصدر الطلب (Origin/Referer) مع نطاق الخادم الفعلي،
 * مع مراعاة ترويسات البروكسي العكسي الموثوقة وحظر طلبات المتصفح المريبة
 */
export function validateRequestOrigin(req: NextRequest): { valid: boolean; reason?: string } {
  // 1. استخراج المضيف الفعلي عبر ترويسة X-Forwarded-Host أو Host
  const rawExpectedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const expectedHost = normalizeHost(rawExpectedHost);

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());

  let originHost: string | null = null;
  if (origin) {
    try {
      originHost = normalizeHost(new URL(origin).host);
    } catch (_e) {}
  }

  let refererHost: string | null = null;
  if (referer) {
    try {
      refererHost = normalizeHost(new URL(referer).host);
    } catch (_e) {}
  }

  // 2. فحص ترويسة أمان المتصفح Sec-Fetch-Site (السماح بالمصادر الموثوقة لـ crmsalon.de)
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') {
    if (!isTrustedHost(originHost) && !isTrustedHost(refererHost)) {
      return { valid: false, reason: 'Cross-site request blocked by Sec-Fetch-Site policy.' };
    }
  }

  if (!expectedHost) {
    return { valid: false, reason: 'Missing Host and X-Forwarded-Host header.' };
  }

  // 3. فحص Origin إن وُجد (الخيار الأساسي لطلبات المتصفح عبر CORS/Fetch/Form)
  if (origin) {
    if (originHost) {
      if (originHost !== expectedHost && !isTrustedHost(originHost)) {
        return {
          valid: false,
          reason: `Origin host "${originHost}" does not match server host "${expectedHost}".`,
        };
      }
      return { valid: true };
    }
  }

  // 4. في حال غياب Origin، فحص Referer
  if (referer) {
    if (refererHost) {
      if (refererHost !== expectedHost && !isTrustedHost(refererHost)) {
        return {
          valid: false,
          reason: `Referer host "${refererHost}" does not match server host "${expectedHost}".`,
        };
      }
      return { valid: true };
    } else {
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
