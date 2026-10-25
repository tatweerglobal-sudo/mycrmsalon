// src/lib/auth/edge-session.ts
// التحقق من توكنات الجلسة داخل بيئة Edge Runtime الخاصة بـ Next.js Middleware
// يعتمد حصرياً على Web Crypto API القياسية المدعومة عالمياً

export interface EdgeSessionPayload {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  fullName: string;
  branchId?: string | null;
  isSuperAdmin?: boolean;
  tokenVersion?: number;
  issuedAt: number;
  expiresAt: number;
}

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

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * التحقق الآمن من توكن الجلسة في بيئة Edge Middleware
 */
export async function verifySessionInEdge(token: string): Promise<EdgeSessionPayload | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) return null;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(getSessionSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const computedBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payloadBase64));
    const expectedSignature = bufferToBase64Url(computedBuffer);

    // التحقق من التوقيع بتطابق ثابت التوقيت (Constant-Time)
    if (signature.length !== expectedSignature.length) {
      return null;
    }
    let diff = 0;
    for (let i = 0; i < signature.length; i++) {
      diff |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    if (diff !== 0) {
      return null;
    }

    // فك تشفير محتوى الـ JSON بفك ترميز UTF-8 سليم للغة العربية
    const payloadBytes = base64UrlToUint8Array(payloadBase64);
    const jsonStr = new TextDecoder('utf-8').decode(payloadBytes);
    const payload: EdgeSessionPayload = JSON.parse(jsonStr);

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
