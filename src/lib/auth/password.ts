// src/lib/auth/password.ts
// تشفير والتحقق من كلمات المرور باستخدام خوارزمية bcrypt القياسية

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * تشفير كلمة المرور بنظام salt هاش آمن
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 12) {
    throw new Error('يجب أن تتكون كلمة المرور من 12 حرفاً على الأقل.');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * التحقق من كلمة المرور المدخلة مقارنة بالتجزئة المحفوظة
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch (_e) {
    return false;
  }
}
