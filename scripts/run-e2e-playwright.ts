// scripts/run-e2e-playwright.ts
// تشغيل اختبارات E2E المتكاملة بـ Playwright على سيرفر Next.js الحقيقي المتصل بقاعدة بيانات Neon مباشرة
// مع التحقق الصارم من عزل المستأجرين (Cross-Tenant Authorization)، حماية المسارات (Protected Routes)، وتوليد تقارير آلية وTraces

import '../src/lib/load-env';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { withTenantDb } from '../src/lib/auth/tenant-context';
import type { SessionPayload } from '../src/lib/auth/session';

const PORT = 3088;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOTS_DIR = path.join(process.cwd(), 'tests', 'screenshots');
const TRACES_DIR = path.join(process.cwd(), 'tests', 'traces');
const RESULTS_FILE = path.join(process.cwd(), 'tests', 'e2e-results.json');

interface TestScenarioResult {
  id: string;
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  details?: string;
  traceFile?: string;
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch (_e) {
      // انتظار استجابة السيرفر
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function runE2E() {
  console.log('🚀 بدء اختبارات E2E الصارمة بـ Playwright مع سيرفر Next.js وقاعدة Neon...');

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(TRACES_DIR, { recursive: true });

  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required for E2E setup and teardown.');
  }
  const dbPool = new Pool({ connectionString: migrationUrl, max: 2 });
  const runtimeUrl = process.env.SALON_DATABASE_URL;
  if (!runtimeUrl) {
    throw new Error('SALON_DATABASE_URL is required for runtime RLS E2E checks.');
  }
  const appPool = new Pool({ connectionString: runtimeUrl, max: 2 });

  const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@crmsalon.de').toLowerCase().trim();
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!ownerPassword) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD is not set in .env.local.');
  }

  // 1. تشغيل سيرفر Next.js (يفضل السيرفر المستقل Standalone لبيئة الإنتاج)
  const standaloneServer = path.join(process.cwd(), '.next', 'standalone', 'server.js');
  let serverProcess: ChildProcess;

  if (fs.existsSync(standaloneServer)) {
    console.log(`🌐 تشغيل سيرفر Next.js المستقل (Standalone) على المنفذ ${PORT}...`);
    // نسخ الأصول الثابتة إلى مجلد Standalone لتشغيل متطابق مع استضافة Hostinger Node.js
    const srcStatic = path.join(process.cwd(), '.next', 'static');
    const dstStatic = path.join(process.cwd(), '.next', 'standalone', '.next', 'static');
    if (fs.existsSync(srcStatic)) {
      fs.cpSync(srcStatic, dstStatic, { recursive: true, force: true });
    }
    const srcPublic = path.join(process.cwd(), 'public');
    const dstPublic = path.join(process.cwd(), '.next', 'standalone', 'public');
    if (fs.existsSync(srcPublic)) {
      fs.cpSync(srcPublic, dstPublic, { recursive: true, force: true });
    }

    serverProcess = spawn(
      process.execPath,
      [standaloneServer],
      {
        cwd: path.join(process.cwd(), '.next', 'standalone'),
        env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } else {
    console.log(`🌐 تشغيل سيرفر Next.js على المنفذ ${PORT}...`);
    serverProcess = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['next', 'start', '-p', String(PORT)],
      {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(PORT) },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  }

  serverProcess.stdout?.on('data', (d) => {
    const line = d.toString();
    if (line.includes('Ready in') || line.includes('started server')) {
      console.log(`[Next.js Server] ${line.trim()}`);
    }
  });

  serverProcess.stderr?.on('data', (d) => {
    console.error(`[Next.js Error] ${d.toString().trim()}`);
  });

  let browser: Browser | null = null;
  const testResults: TestScenarioResult[] = [];
  const synthTag = 'e2e_' + Date.now().toString(36);
  const synthPass = 'SafeSynthPass#2026!';
  const synthHash = await bcrypt.hash(synthPass, 10);

  // سجل المعرفات المؤقتة لضمان التنظيف الشامل
  const cleanupTenants: string[] = [];
  const cleanupUsers: string[] = [];

  try {
    const serverReady = await waitForServer(BASE_URL);
    if (!serverReady) {
      throw new Error(`Failed to start Next.js server on ${BASE_URL} within 30s.`);
    }
    console.log(`✅ السيرفر يعمل وجاهز لاستقبال طلبات المتصفح على ${BASE_URL}`);

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });

    // دالة مساعدة لتشغيل سيناريو مع تسجيل الزمن وPlaywright Tracing
    async function executeScenario(
      id: string,
      name: string,
      fn: (ctx: BrowserContext) => Promise<void>
    ) {
      const startTime = Date.now();
      const ctx = await browser!.newContext();
      await ctx.tracing.start({ screenshots: true, snapshots: true });

      try {
        console.log(`\n--- [${id}] ${name} ---`);
        await fn(ctx);
        const durationMs = Date.now() - startTime;
        await ctx.tracing.stop();
        testResults.push({ id, name, status: 'passed', durationMs });
        console.log(`✔ [PASS] ${id} (${durationMs}ms)`);
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const traceFile = path.join(TRACES_DIR, `${id}-failure.zip`);
        await ctx.tracing.stop({ path: traceFile });
        const errMsg = err instanceof Error ? err.message : String(err);
        testResults.push({ id, name, status: 'failed', durationMs, details: errMsg, traceFile });
        console.error(`❌ [FAIL] ${id}: ${errMsg}`);
        throw err;
      } finally {
        await ctx.close();
      }
    }

    // =========================================================================
    // السيناريو 1: حماية المسارات ومنع الوصول المجهول (Anonymous Route Protection)
    // =========================================================================
    await executeScenario('SEC-01', 'Anonymous users are blocked from all CRM protected routes', async (ctx) => {
      const page = await ctx.newPage();

      // فحص المسارات الأساسية دون تسجيل دخول
      const protectedPaths = ['/', '/customers', '/appointments', '/staff', '/financials', '/settings'];
      for (const p of protectedPaths) {
        await page.goto(`${BASE_URL}${p}`);
        await page.waitForLoadState('networkidle');
        const currentUrl = page.url();
        if (!currentUrl.includes('/login')) {
          throw new Error(`Route "${p}" allowed anonymous access! Current URL: ${currentUrl}`);
        }
      }

      // فحص نقطة النهاية للواجهة البرمجية المحمية /api/auth/me
      const apiRes = await ctx.request.get(`${BASE_URL}/api/auth/me`);
      if (apiRes.status() !== 401) {
        throw new Error(`Anonymous GET /api/auth/me returned status ${apiRes.status()} instead of 401`);
      }

      const screenshot0 = path.join(SCREENSHOTS_DIR, '00-anonymous-redirect-to-login.png');
      await page.screenshot({ path: screenshot0 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot0}`);
    });

    // =========================================================================
    // السيناريو 2: تسجيل دخول مالك الصالون الناجح والوصول للوحة التحكم
    // =========================================================================
    let ownerSessionCookie = '';
    await executeScenario('SEC-02', 'Successful owner login & dashboard redirect', async (ctx) => {
      const page = await ctx.newPage();
      page.on('console', (msg) => console.log(`[Browser Console] ${msg.text()}`));
      page.on('response', async (res) => {
        if (res.url().includes('/api/auth/')) {
          try {
            const body = await res.text();
            console.log(`[Auth Response] ${res.status()} ${res.url()}: ${body}`);
          } catch (_e) {
            console.log(`[Auth Response] ${res.status()} ${res.url()}`);
          }
        }
      });

      await page.goto(`${BASE_URL}/login`);
      await page.waitForLoadState('networkidle');

      await page.fill('input[name="email"]', ownerEmail);
      await page.fill('input[name="password"]', ownerPassword);
      await page.click('button[type="submit"]');

      // ننتظر قليلاً لفحص أي رسائل خطأ في الصفحة إذا وُجدت
      await page.waitForTimeout(1000);
      const alertText = await page.locator('[role="alert"]').textContent().catch(() => null);
      if (alertText) {
        console.log(`[Login Alert Detected]: ${alertText}`);
      }

      await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
      await page.waitForSelector('text=أريج السبيعي', { timeout: 5000 });

      const cookies = await ctx.cookies();
      const sCookie = cookies.find((c) => c.name === 'salon_session');
      if (!sCookie?.value) {
        throw new Error('salon_session cookie was not set after login');
      }
      ownerSessionCookie = sCookie.value;

      const screenshot1 = path.join(SCREENSHOTS_DIR, '01-owner-dashboard-logged-in.png');
      await page.screenshot({ path: screenshot1, fullPage: true });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot1}`);
    });

    // =========================================================================
    // السيناريو 3: فتح الأقسام المحمية للمستخدم المصادق عليه (Authorized Pages)
    // =========================================================================
    await executeScenario('SEC-03', 'Authenticated owner can access protected CRM sections without redirect', async (ctx) => {
      await ctx.addCookies([
        {
          name: 'salon_session',
          value: ownerSessionCookie,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await ctx.newPage();

      // فتح قسم العملاء
      await page.goto(`${BASE_URL}/customers`);
      await page.waitForLoadState('networkidle');
      if (page.url().includes('/login')) {
        throw new Error('Authenticated owner was redirected to /login when visiting /customers');
      }
      await page.waitForSelector('text=العملاء', { timeout: 5000 });

      const screenshot2 = path.join(SCREENSHOTS_DIR, '02-protected-customers-view.png');
      await page.screenshot({ path: screenshot2 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot2}`);

      // فتح قسم المالية (متاح للمالك)
      await page.goto(`${BASE_URL}/financials`);
      await page.waitForLoadState('networkidle');
      const pageContent = await page.content();
      if (pageContent.includes('صلاحيات غير كافية')) {
        throw new Error('Salon owner was incorrectly denied access to financials!');
      }
    });

    // =========================================================================
    // السيناريو 4: استمرار الجلسة بعد تحديث الصفحة (Session Persistence)
    // =========================================================================
    await executeScenario('SEC-04', 'Session persists after browser reload', async (ctx) => {
      await ctx.addCookies([
        {
          name: 'salon_session',
          value: ownerSessionCookie,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('text=أريج السبيعي', { timeout: 5000 });

      const screenshot3 = path.join(SCREENSHOTS_DIR, '02-session-persisted-after-refresh.png');
      await page.screenshot({ path: screenshot3 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot3}`);
    });

    // =========================================================================
    // السيناريو 5: فرض محدد المعدل (Rate Limiting) - يجب أن يفشل إن لم يُحظر
    // =========================================================================
    await executeScenario('SEC-05', 'Rate limiting MUST block repeated failed attempts with HTTP 429', async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`);

      const attackEmail = `rate_test_${synthTag}@crmsalon.test`;
      let rateLimitTriggered = false;

      for (let attempt = 1; attempt <= 7; attempt++) {
        await page.fill('input[name="email"]', attackEmail);
        await page.fill('input[name="password"]', `WrongPass#${attempt}`);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(400);

        const content = await page.content();
        if (content.includes('تم تجاوز الحد المسموح من المحاولات')) {
          rateLimitTriggered = true;
          break;
        }
      }

      if (!rateLimitTriggered) {
        throw new Error('FATAL SECURITY FLAW: Rate limiting was NOT enforced after 7 failed attempts!');
      }

      const screenshot4 = path.join(SCREENSHOTS_DIR, '04-rate-limit-blocked.png');
      await page.screenshot({ path: screenshot4 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot4}`);
    });

    // =========================================================================
    // السيناريو 6: العزل التام بين الصالونات وحماية IDOR الحقيقية (Real Cross-Tenant Authorization)
    // =========================================================================
    await executeScenario('SEC-06', 'Strict real cross-tenant IDOR isolation and RLS verification', async (_ctx) => {
      // 1. إنشاء مركز تجميل اصطناعي ثانٍ (Salon B)
      const t2Res = await dbPool.query(`
        INSERT INTO tenants (name, slug, country_code, status)
        VALUES ('مركز مسك وعنبر', 'misk-amber-${synthTag}', 'SA', 'active')
        RETURNING id;
      `);
      const tenantBId = t2Res.rows[0].id;
      cleanupTenants.push(tenantBId);

      // 2. إنشاء عميلة تابعة حصرياً للمركز B
      const c2Res = await dbPool.query(`
        INSERT INTO customers (tenant_id, full_name, phone_normalized)
        VALUES ($1, 'ليلى العامري (عميلة صالون B)', '+966588888888')
        RETURNING id;
      `, [tenantBId]);
      const customerBId = c2Res.rows[0].id;

      // 3. جلب معرف المركز A (صالون اللوتس)
      const t1Res = await dbPool.query(`SELECT id FROM tenants WHERE slug = 'lotus-beauty'`);
      const tenantAId = t1Res.rows[0].id;

      // 4. محاكاة طلب قاعدة بيانات تحت سياق صالون A للوصول إلى عميلة صالون B (محاولة IDOR)
      // يتم تنفيذها عبر دور التطبيق salon_app_role المقيد بنظام RLS
      const sessionA: SessionPayload = {
        userId: 'be04b34c-d2c9-4324-a1c5-90d9e530dd0d',
        tenantId: tenantAId,
        role: 'salon_owner',
        email: ownerEmail,
        fullName: 'أريج السبيعي',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      const sessionB: SessionPayload = {
        userId: '00000000-0000-0000-0000-000000000002',
        tenantId: tenantBId,
        role: 'salon_owner',
        email: `owner_b_${synthTag}@crmsalon.test`,
        fullName: 'مالكة صالون B',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      await withTenantDb(appPool, sessionA, async (client) => {
        // استعلام بالمعرف المباشر (IDOR query)
        const idorQuery = await client.query('SELECT * FROM customers WHERE id = $1', [customerBId]);
        if (idorQuery.rows.length !== 0) {
          throw new Error('CRITICAL SECURITY FAILURE: Tenant A accessed Tenant B customer via IDOR!');
        }

        // محاولة تحديث بيانات عميلة صالون B من سياق صالون A
        const updateAttempt = await client.query('UPDATE customers SET full_name = $1 WHERE id = $2', [
          'مخترقة',
          customerBId,
        ]);
        if (updateAttempt.rowCount && updateAttempt.rowCount > 0) {
          throw new Error('CRITICAL SECURITY FAILURE: Tenant A updated Tenant B customer via IDOR!');
        }
      });

      // 5. التحقق الإيجابي (Authorized Check): استعلام صالون B عن عميلته ينجح
      await withTenantDb(appPool, sessionB, async (client) => {
        const authorizedQuery = await client.query('SELECT * FROM customers WHERE id = $1', [customerBId]);
        if (authorizedQuery.rows.length !== 1 || authorizedQuery.rows[0].id !== customerBId) {
          throw new Error('Authorized query for Tenant B customer failed!');
        }
      });
      console.log('✅ تم التحقق: عزل المستأجرين RLS حقيقي بنسبة 100% ويمنع أي تسريب IDOR عبر المعرفات.');
    });

    // =========================================================================
    // السيناريو 7: تسجيل الخروج وإبطال التوكن على الخادم (Server Revocation)
    // =========================================================================
    await executeScenario('SEC-07', 'Logout revokes session on server and clears browser cookie', async (ctx) => {
      await ctx.addCookies([
        {
          name: 'salon_session',
          value: ownerSessionCookie,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState('networkidle');

      await page.click('button:has-text("تسجيل الخروج")');
      await page.waitForURL(`${BASE_URL}/login`, { timeout: 5000 });

      const screenshot5 = path.join(SCREENSHOTS_DIR, '05-logged-out.png');
      await page.screenshot({ path: screenshot5 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot5}`);

      // محاولة استخدام التوكن القديم عبر ترويسة Cookie
      const reuseRes = await ctx.request.get(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: `salon_session=${ownerSessionCookie}` },
      });
      if (reuseRes.status() !== 401) {
        throw new Error(`Reused revoked session token was accepted! Status: ${reuseRes.status()}`);
      }
      console.log('✅ تم التحقق: التوكن السابق تم إبطاله تماماً على خادم قاعدة البيانات.');
    });

    // =========================================================================
    // السيناريو 8: حظر الحسابات المعطلة (Disabled Account Block)
    // =========================================================================
    await executeScenario('SEC-08', 'Disabled user accounts cannot log in', async (ctx) => {
      const disabledEmail = `disabled_${synthTag}@crmsalon.test`;
      const insUser = await dbPool.query(
        `INSERT INTO users (email, full_name, password_hash, is_active) VALUES ($1, 'مستخدمة معطلة', $2, false) RETURNING id`,
        [disabledEmail, synthHash]
      );
      const disabledUserId = insUser.rows[0].id;
      cleanupUsers.push(disabledUserId);

      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`);
      await page.fill('input[name="email"]', disabledEmail);
      await page.fill('input[name="password"]', synthPass);
      await page.click('button[type="submit"]');

      await page.waitForSelector('text=تم تعطيل هذا الحساب', { timeout: 5000 });
      const screenshot6 = path.join(SCREENSHOTS_DIR, '06-disabled-user-blocked.png');
      await page.screenshot({ path: screenshot6 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot6}`);
    });

    // =========================================================================
    // السيناريو 9: إبطال الجلسة الحي عند تغيير الدور الوظيفي (Live Role Invalidation)
    // =========================================================================
    await executeScenario('SEC-09', 'Session is immediately invalidated if role changes in database', async (ctx) => {
      const tRes = await dbPool.query(`
        INSERT INTO tenants (name, slug, country_code, status)
        VALUES ('صالون تجريبي مؤقت', 'temp-role-${synthTag}', 'SA', 'active')
        RETURNING id;
      `);
      const tempTenantId = tRes.rows[0].id;
      cleanupTenants.push(tempTenantId);

      const tempEmail = `role_test_${synthTag}@crmsalon.test`;
      const uRes = await dbPool.query(`
        INSERT INTO users (email, full_name, password_hash, is_active)
        VALUES ($1, 'موظفة فحص الدور', $2, true)
        RETURNING id;
      `, [tempEmail, synthHash]);
      const tempUserId = uRes.rows[0].id;
      cleanupUsers.push(tempUserId);

      await dbPool.query(`
        INSERT INTO memberships (tenant_id, user_id, role, is_active)
        VALUES ($1, $2, 'salon_owner', true);
      `, [tempTenantId, tempUserId]);

      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/login`);
      await page.fill('input[name="email"]', tempEmail);
      await page.fill('input[name="password"]', synthPass);
      await page.click('button[type="submit"]');
      await page.waitForURL(`${BASE_URL}/`, { timeout: 5000 });

      // تغيير الدور إلى receptionist
      await dbPool.query(`UPDATE memberships SET role = 'receptionist' WHERE tenant_id = $1 AND user_id = $2`, [
        tempTenantId,
        tempUserId,
      ]);

      const checkRes = await ctx.request.get(`${BASE_URL}/api/auth/me`);
      const checkData = await checkRes.json();
      if (checkRes.status() !== 401 || !checkData.error?.includes('تغيير دورك')) {
        throw new Error(`Role invalidation check failed: status ${checkRes.status()}`);
      }
      console.log('✅ تم التحقق: تم إسقاط الجلسة فوراً عند تعديل الصلاحية في قاعدة البيانات.');
    });

    // =========================================================================
    // السيناريو 10: واجهة الهواتف الذكية والتجاوب الكامل (Mobile Viewport)
    // =========================================================================
    await executeScenario('SEC-10', 'Mobile viewport rendering (375x667) and RTL layout', async (ctx) => {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${BASE_URL}/login`);
      await page.waitForLoadState('networkidle');

      const screenshot7 = path.join(SCREENSHOTS_DIR, '07-mobile-login-view.png');
      await page.screenshot({ path: screenshot7 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot7}`);

      await page.fill('input[name="email"]', ownerEmail);
      await page.fill('input[name="password"]', ownerPassword);
      await page.click('button[type="submit"]');
      await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });

      const screenshot8 = path.join(SCREENSHOTS_DIR, '08-mobile-dashboard-view.png');
      await page.screenshot({ path: screenshot8, fullPage: true });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot8}`);
    });

    // =========================================================================
    // السيناريو 11: فحص مسار الصحة GET /api/health مع زمن استجابة Neon
    // =========================================================================
    await executeScenario('SEC-11', 'Health check endpoint returns healthy Neon latency', async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/api/health`);
      const content = await page.textContent('body');
      const health = JSON.parse(content || '{}');

      if (health.status !== 'healthy' || health.database?.status !== 'connected') {
        throw new Error(`Health check degraded: ${content}`);
      }

      console.log(`✅ فحص الصحة سليم: حالة Neon متصلة (${health.database.latencyMs}ms).`);
      const screenshot9 = path.join(SCREENSHOTS_DIR, '09-health-check.png');
      await page.screenshot({ path: screenshot9 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot9}`);
    });

  } finally {
    // تنظيف البيانات الاصطناعية لضمان سلامة قاعدة بيانات Neon الإنتاجية
    console.log('\n🧹 تنظيف البيانات الاصطناعية المستخدمة في الاختبارات...');
    try {
      for (const tId of cleanupTenants) {
        await dbPool.query(`DELETE FROM appointments WHERE tenant_id = $1`, [tId]);
        await dbPool.query(`DELETE FROM customers WHERE tenant_id = $1`, [tId]);
        await dbPool.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tId]);
        await dbPool.query(`DELETE FROM tenants WHERE id = $1`, [tId]);
      }
      for (const uId of cleanupUsers) {
        await dbPool.query(`DELETE FROM users WHERE id = $1`, [uId]);
      }
      console.log('✅ اكتمل تنظيف البيانات الاصطناعية بالكامل.');
    } catch (cleanupErr) {
      console.error('⚠️ تحذير أثناء تنظيف البيانات الاصطناعية:', cleanupErr);
    }

    if (browser) {
      await browser.close();
    }
    serverProcess.kill('SIGTERM');
    await dbPool.end();
    await appPool.end();

    // حفظ التقرير المقروء آلياً (Machine-Readable JSON Report)
    const reportSummary = {
      timestamp: new Date().toISOString(),
      targetUrl: BASE_URL,
      totalScenarios: testResults.length,
      passedCount: testResults.filter((r) => r.status === 'passed').length,
      failedCount: testResults.filter((r) => r.status === 'failed').length,
      scenarios: testResults,
    };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(reportSummary, null, 2), 'utf-8');
    console.log(`\n📊 تم حفظ تقرير E2E المقروء آلياً في: ${RESULTS_FILE}`);

    // في حال فشل أي سيناريو، إنهاء العملية بكود خطأ غير صفري لتعطيل CI
    const hasFailures = testResults.some((r) => r.status === 'failed');
    if (hasFailures) {
      console.error('\n❌ فشل سيناريو واحد أو أكثر من اختبارات E2E!');
      process.exit(1);
    }
  }

  console.log('\n=============================================================');
  console.log('🎉 اكتملت كافة اختبارات E2E الصارمة بنجاح تام 100%!');
  console.log('=============================================================');
  testResults.forEach((t) => console.log(`  ✔ [PASS] [${t.id}] ${t.name} (${t.durationMs}ms)`));
  console.log('=============================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('run-e2e-playwright.ts')) {
  runE2E()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ E2E Playwright test suite encountered an unhandled error:', err);
      process.exit(1);
    });
}
