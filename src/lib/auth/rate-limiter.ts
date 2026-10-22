// src/lib/auth/rate-limiter.ts
// محرك تحديد معدل الطلبات وحماية نقاط المصادقة من هجمات التخمين (Brute-force)

interface RateLimitRecord {
  attempts: number[];
}

export class MemoryRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /**
   * فحص وتسجيل محاولة للمفتاح المحدد (مثلاً IP أو البريد الإلكتروني)
   * يعود بـ { allowed: boolean, remainingAttempts: number, retryAfterSeconds?: number }
   */
  check(key: string): { allowed: boolean; remainingAttempts: number; retryAfterSeconds?: number } {
    const now = Date.now();
    const record = this.records.get(key) || { attempts: [] };

    // تصفية المحاولات القديمة خارج النافذة الزمنية
    record.attempts = record.attempts.filter(timestamp => now - timestamp < this.windowMs);

    if (record.attempts.length >= this.maxAttempts) {
      const oldest = record.attempts[0];
      const retryAfterSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      };
    }

    record.attempts.push(now);
    this.records.set(key, record);

    // تنظيف دوري للذاكرة إذا كبر الحجم
    if (this.records.size > 5000) {
      this.cleanup(now);
    }

    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - record.attempts.length,
    };
  }

  /**
   * إعادة ضبط المحاولات عند تسجيل الدخول الناجح
   */
  reset(key: string): void {
    this.records.delete(key);
  }

  private cleanup(now: number): void {
    for (const [key, record] of this.records.entries()) {
      const valid = record.attempts.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.records.delete(key);
      } else {
        record.attempts = valid;
      }
    }
  }
}

// مثيل عام لحماية تسجيل الدخول: 5 محاولات خلال 15 دقيقة
export const loginRateLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
