// src/lib/auth/rate-limiter.ts
// محرك تحديد معدل الطلبات وحماية نقاط المصادقة من هجمات التخمين (Brute-force)

import type { Pool } from 'pg';

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}

export interface IRateLimiter {
  check(key: string): Promise<RateLimitResult> | RateLimitResult;
  reset(key: string): Promise<void> | void;
}

/**
 * ==============================================================================
 * 1. محدد معدل الطلبات في الذاكرة (In-Memory Rate Limiter)
 * ==============================================================================
 * تنبيه معماري وأمني هام (Architectural Note):
 * هذا المحرك مخصص للتطوير المحلي (Local Dev) والبيئات ذات الخادم الفردي (Single Node).
 * ⚠️ لا يكفي للبيئات الموزعة أو Serverless (مثل Vercel / Kubernetes / Multiple Containers)
 * لأن الذاكرة غير مشتركة بين النسخ المتعددة للخادم، مما قد يسمح بتجاوز الحظر عند توزيع
 * الطلبات على حاويات مختلفة. للإنتاج الموزع، يجب استخدام PostgresRateLimiter أو Redis.
 */
interface RateLimitRecord {
  attempts: number[];
}

export class MemoryRateLimiter implements IRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const record = this.records.get(key) || { attempts: [] };

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

    if (this.records.size > 5000) {
      this.cleanup(now);
    }

    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - record.attempts.length,
    };
  }

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

/**
 * ==============================================================================
 * 2. محدد معدل الطلبات بالحالة المشتركة عبر PostgreSQL (Distributed Shared-State)
 * ==============================================================================
 * يعتمد على جدول auth_rate_limits المشترك ويعمل عبر كافة الحاويات والخوادم الموزعة
 */
export class PostgresRateLimiter implements IRateLimiter {
  private pool: Pool;
  private maxAttempts: number;
  private windowSeconds: number;

  constructor(pool: Pool, maxAttempts = 5, windowSeconds = 15 * 60) {
    this.pool = pool;
    this.maxAttempts = maxAttempts;
    this.windowSeconds = windowSeconds;
  }

  async check(key: string): Promise<RateLimitResult> {
    const client = await this.pool.connect();
    try {
      const now = new Date();
      const res = await client.query(
        `SELECT attempts, first_attempt_at, last_attempt_at FROM auth_rate_limits WHERE key = $1`,
        [key]
      );

      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO auth_rate_limits (key, attempts, first_attempt_at, last_attempt_at) VALUES ($1, 1, $2, $2)`,
          [key, now]
        );
        return { allowed: true, remainingAttempts: this.maxAttempts - 1 };
      }

      const row = res.rows[0];
      const elapsedSeconds = Math.floor((now.getTime() - new Date(row.first_attempt_at).getTime()) / 1000);

      // إذا انتهت النافذة الزمنية، يتم التصفير
      if (elapsedSeconds >= this.windowSeconds) {
        await client.query(
          `UPDATE auth_rate_limits SET attempts = 1, first_attempt_at = $2, last_attempt_at = $2 WHERE key = $1`,
          [key, now]
        );
        return { allowed: true, remainingAttempts: this.maxAttempts - 1 };
      }

      // إذا كان ضمن النافذة وتجاوز الحد
      if (row.attempts >= this.maxAttempts) {
        const retryAfterSeconds = this.windowSeconds - elapsedSeconds;
        return {
          allowed: false,
          remainingAttempts: 0,
          retryAfterSeconds: Math.max(1, retryAfterSeconds),
        };
      }

      // زيادة عدد المحاولات
      const newAttempts = row.attempts + 1;
      await client.query(
        `UPDATE auth_rate_limits SET attempts = $2, last_attempt_at = $3 WHERE key = $1`,
        [key, newAttempts, now]
      );

      return {
        allowed: true,
        remainingAttempts: this.maxAttempts - newAttempts,
      };
    } finally {
      client.release();
    }
  }

  async reset(key: string): Promise<void> {
    await this.pool.query(`DELETE FROM auth_rate_limits WHERE key = $1`, [key]);
  }
}

// مثيل عام افتراضي للاستخدام في الذاكرة
export const loginRateLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
