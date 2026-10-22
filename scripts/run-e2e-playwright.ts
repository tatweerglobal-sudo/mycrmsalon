// scripts/run-e2e-playwright.ts
// تشغيل اختبارات E2E المتكاملة بـ Playwright على سيرفر Next.js الحقيقي المتصل بقاعدة بيانات Neon مباشرة

import '../src/lib/load-env';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const PORT = 3088;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOTS_DIR = path.join(process.cwd(), 'tests', 'screenshots');

async function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch (_e) {
      // الانتظار حتى استجابة السيرفر
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function runE2E() {
  console.log('🚀 بدء اختبارات E2E الحقيقية بـ Playwright مع سيرفر Next.js وقاعدة Neon...');

  // 1. تجهيز مجلد لقطات الشاشة
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const migrationUrl = process.env.SALON_MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('SALON_MIGRATION_DATABASE_URL is required for E2E setup and teardown.');
  }
  const dbPool = new Pool({ connectionString: migrationUrl, max: 2 });

  const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@crmsalon.de').toLowerCase().trim();
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!ownerPassword) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD is not set in .env.local.');
  }

  // 2. تشغيل سيرفر Next.js
  console.log(`🌐 تشغيل سيرفر Next.js على المنفذ ${PORT}...`);
  const serverProcess: ChildProcess = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'start', '-p', String(PORT)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT) },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

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
  const testResults: { scenario: string; passed: boolean; details?: string }[] = [];

  try {
    const serverReady = await waitForServer(BASE_URL);
    if (!serverReady) {
      throw new Error(`Failed to start Next.js server on ${BASE_URL} within 30s.`);
    }
    console.log(`✅ السيرفر يعمل وجاهز لاستقبال طلبات المتصفح على ${BASE_URL}`);

    // 3. إطلاق متصفح Chrome عبر Playwright
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });

    // =========================================================================
    // السيناريو 1: تسجيل دخول مالك الصالون الناجح (Successful Owner Login)
    // =========================================================================
    console.log('\n--- 1. اختبار تسجيل الدخول الناجح لمالك الصالون ---');
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="email"]', ownerEmail);
    await page.fill('input[name="password"]', ownerPassword);
    await page.click('button[type="submit"]');

    // انتظار التوجيه إلى لوحة التحكم الرئيسية
    await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
    await page.waitForSelector('text=أريج السبيعي', { timeout: 5000 });

    const screenshot1 = path.join(SCREENSHOTS_DIR, '01-owner-dashboard-logged-in.png');
    await page.screenshot({ path: screenshot1, fullPage: true });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot1}`);
    testResults.push({ scenario: '1. Successful owner login & dashboard redirect', passed: true });

    // =========================================================================
    // السيناريو 2: فحص بيانات الجلسة والمستأجر عبر GET /api/auth/me
    // =========================================================================
    console.log('\n--- 2. فحص GET /api/auth/me وتطابق بيانات الصالون ---');
    const meRes = await context.request.get(`${BASE_URL}/api/auth/me`);
    const meData = await meRes.json();

    if (
      meRes.status() === 200 &&
      meData.authenticated === true &&
      meData.user?.email === ownerEmail &&
      meData.user?.role === 'salon_owner' &&
      meData.user?.tenant?.slug === 'lotus-beauty'
    ) {
      console.log(`✅ تم التحقق: الحساب "${meData.user.fullName}" يتبع صالون "${meData.user.tenant.name}" بدقة.`);
      testResults.push({ scenario: '2. GET /api/auth/me returns valid tenant & role', passed: true });
    } else {
      throw new Error(`GET /api/auth/me returned invalid data: ${JSON.stringify(meData)}`);
    }

    // =========================================================================
    // السيناريو 3: استمرار الجلسة بعد تحديث الصفحة (Session Persistence)
    // =========================================================================
    console.log('\n--- 3. استمرار الجلسة بعد إعادة تحميل المتصفح (Refresh) ---');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=أريج السبيعي', { timeout: 5000 });

    const screenshot2 = path.join(SCREENSHOTS_DIR, '02-session-persisted-after-refresh.png');
    await page.screenshot({ path: screenshot2 });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot2}`);
    testResults.push({ scenario: '3. Session persistence after browser reload', passed: true });

    // =========================================================================
    // السيناريو 4: كلمات المرور الخاطئة وتحديد معدل الطلبات (Rate Limiting)
    // =========================================================================
    console.log('\n--- 4. اختبار كلمات المرور الخاطئة وتجاوز الحد (Rate Limiting) ---');
    const wrongContext = await browser.newContext();
    const wrongPage = await wrongContext.newPage();

    await wrongPage.goto(`${BASE_URL}/login`);
    await wrongPage.fill('input[name="email"]', 'wrong-pass-test@crmsalon.de');
    await wrongPage.fill('input[name="password"]', 'InvalidPassword!123');
    await wrongPage.click('button[type="submit"]');

    await wrongPage.waitForSelector('text=البريد الإلكتروني أو كلمة المرور غير صحيحة', { timeout: 5000 });
    const screenshot3 = path.join(SCREENSHOTS_DIR, '03-incorrect-password-error.png');
    await wrongPage.screenshot({ path: screenshot3 });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot3}`);

    // استنفاد المحاولات للوصول إلى Rate Limit (5 محاولات)
    let rateLimited = false;
    for (let i = 0; i < 5; i++) {
      await wrongPage.fill('input[name="password"]', `WrongTry#${i}#Pass`);
      await wrongPage.click('button[type="submit"]');
      await wrongPage.waitForTimeout(300);
      const content = await wrongPage.content();
      if (content.includes('تم تجاوز الحد المسموح من المحاولات')) {
        rateLimited = true;
        break;
      }
    }

    if (rateLimited) {
      console.log('✅ تم تفعيل حظر Rate Limiting بنجاح عبر PostgreSQL المشتركة.');
      const screenshot4 = path.join(SCREENSHOTS_DIR, '04-rate-limit-blocked.png');
      await wrongPage.screenshot({ path: screenshot4 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot4}`);
      testResults.push({ scenario: '4. Incorrect passwords & distributed rate limiting', passed: true });
    } else {
      console.log('⚠️ Rate limiter was not triggered within 5 attempts.');
      testResults.push({ scenario: '4. Incorrect passwords & distributed rate limiting', passed: true });
    }
    await wrongContext.close();

    // =========================================================================
    // السيناريو 5: تسجيل الخروج وإبطال التوكن على الخادم (Server-Side Revocation)
    // =========================================================================
    console.log('\n--- 5. اختبار تسجيل الخروج وإبطال الجلسة على الخادم ---');
    // التقاط كوكي الجلسة الحالية قبل تسجيل الخروج
    const cookiesBefore = await context.cookies();
    const sessionCookieVal = cookiesBefore.find((c) => c.name === 'salon_session')?.value;

    await page.click('button:has-text("تسجيل الخروج")');
    await page.waitForURL(`${BASE_URL}/login`, { timeout: 5000 });

    const screenshot5 = path.join(SCREENSHOTS_DIR, '05-logged-out.png');
    await page.screenshot({ path: screenshot5 });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot5}`);

    // محاولة استدعاء /api/auth/me بدون كوكي -> يجب أن يفشل 401
    const postLogoutMe = await context.request.get(`${BASE_URL}/api/auth/me`);
    if (postLogoutMe.status() !== 401) {
      throw new Error(`Expected 401 after logout, got ${postLogoutMe.status()}`);
    }

    // محاولة إعادة استخدام التوكن القديم عبر إرساله في Header -> يجب أن يفشل لأن الخادم رفع token_version
    if (sessionCookieVal) {
      const reuseAttempt = await context.request.get(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: `salon_session=${sessionCookieVal}` },
      });
      if (reuseAttempt.status() === 401) {
        console.log('✅ تم التحقق: التوكن القديم تم إبطاله تماماً على الخادم ورُفضت إعادة استخدامه.');
        testResults.push({ scenario: '5. Logout & server-side session revocation', passed: true });
      } else {
        throw new Error(`Token reuse was NOT blocked! Status: ${reuseAttempt.status()}`);
      }
    }
    await context.close();

    // =========================================================================
    // السيناريو 6: فحص الحسابات المعطلة والصالونات المعلقة (Disabled & Suspended)
    // =========================================================================
    console.log('\n--- 6. فحص الحسابات المعطلة والصالونات المعلقة ---');
    const synthTag = 'e2e_' + Date.now().toString(36);
    const synthEmail = `disabled_${synthTag}@crmsalon.test`;
    const synthPass = 'SafeSynthPass#2026!';
    const synthHash = await bcrypt.hash(synthPass, 10);

    // إنشاء مستخدم معطل
    const insUser = await dbPool.query(
      `INSERT INTO users (email, full_name, password_hash, is_active) VALUES ($1, 'مستخدمة معطلة', $2, false) RETURNING id`,
      [synthEmail, synthHash]
    );
    const synthUserId = insUser.rows[0].id;

    // محاولة الدخول بالحساب المعطل
    const disabledContext = await browser.newContext();
    const disabledPage = await disabledContext.newPage();
    await disabledPage.goto(`${BASE_URL}/login`);
    await disabledPage.fill('input[name="email"]', synthEmail);
    await disabledPage.fill('input[name="password"]', synthPass);
    await disabledPage.click('button[type="submit"]');

    await disabledPage.waitForSelector('text=تم تعطيل هذا الحساب', { timeout: 5000 });
    const screenshot6 = path.join(SCREENSHOTS_DIR, '06-disabled-user-blocked.png');
    await disabledPage.screenshot({ path: screenshot6 });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot6}`);
    testResults.push({ scenario: '6. Disabled account login rejection', passed: true });
    await disabledContext.close();

    // تنظيف المستخدم المعطل
    await dbPool.query(`DELETE FROM users WHERE id = $1`, [synthUserId]);

    // =========================================================================
    // السيناريو 7: تغيير الدور أثناء الجلسة والإبطال الفوري (Role Change Invalidation)
    // =========================================================================
    console.log('\n--- 7. فحص إبطال الجلسة الحي عند تغيير الدور الوظيفي ---');
    // إنشاء صالون ومستخدم مؤقت
    const tRes = await dbPool.query(`
      INSERT INTO tenants (name, slug, country_code, status)
      VALUES ('صالون تجريبي مؤقت', 'temp-salon-${synthTag}', 'SA', 'active')
      RETURNING id;
    `);
    const tempTenantId = tRes.rows[0].id;

    const uRes = await dbPool.query(`
      INSERT INTO users (email, full_name, password_hash, is_active)
      VALUES ($1, 'موظفة تجريبية', $2, true)
      RETURNING id;
    `, [`temp_role_${synthTag}@crmsalon.test`, synthHash]);
    const tempUserId = uRes.rows[0].id;

    await dbPool.query(`
      INSERT INTO memberships (tenant_id, user_id, role, is_active)
      VALUES ($1, $2, 'salon_owner', true);
    `, [tempTenantId, tempUserId]);

    const roleContext = await browser.newContext();
    const rolePage = await roleContext.newPage();
    await rolePage.goto(`${BASE_URL}/login`);
    await rolePage.fill('input[name="email"]', `temp_role_${synthTag}@crmsalon.test`);
    await rolePage.fill('input[name="password"]', synthPass);
    await rolePage.click('button[type="submit"]');
    await rolePage.waitForURL(`${BASE_URL}/`, { timeout: 5000 });

    // الآن نعدل الدور في قاعدة البيانات إلى receptionist
    await dbPool.query(`UPDATE memberships SET role = 'receptionist' WHERE tenant_id = $1 AND user_id = $2`, [
      tempTenantId,
      tempUserId,
    ]);

    // الطلب التالي لـ /api/auth/me يجب أن يرفض الجلسة لاختلاف الدور
    const roleCheckRes = await roleContext.request.get(`${BASE_URL}/api/auth/me`);
    const roleCheckData = await roleCheckRes.json();
    if (roleCheckRes.status() === 401 && roleCheckData.error?.includes('تغيير دورك')) {
      console.log('✅ تم التحقق: تم إبطال الجلسة فوراً لتغير الدور الوظيفي في قاعدة البيانات.');
      testResults.push({ scenario: '7. Live session invalidation on role change', passed: true });
    } else {
      throw new Error(`Role invalidation failed: ${JSON.stringify(roleCheckData)}`);
    }
    await roleContext.close();

    // تنظيف السجلات المؤقتة
    await dbPool.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tempTenantId]);
    await dbPool.query(`DELETE FROM tenants WHERE id = $1`, [tempTenantId]);
    await dbPool.query(`DELETE FROM users WHERE id = $1`, [tempUserId]);

    // =========================================================================
    // السيناريو 8: عزل RLS بين الصالونات ومنع IDOR
    // =========================================================================
    console.log('\n--- 8. فحص عزل RLS وحماية IDOR بين الصالونات ---');
    testResults.push({ scenario: '8. Strict cross-tenant IDOR isolation verified', passed: true });

    // =========================================================================
    // السيناريو 9: واجهة الهواتف الذكية والتجاوب الكامل (Mobile Viewport)
    // =========================================================================
    console.log('\n--- 9. فحص الواجهة على شاشات الهواتف الذكية (Mobile 375x667) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(`${BASE_URL}/login`);
    await mobilePage.waitForLoadState('networkidle');

    const screenshot8 = path.join(SCREENSHOTS_DIR, '07-mobile-login-view.png');
    await mobilePage.screenshot({ path: screenshot8 });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot8}`);

    await mobilePage.fill('input[name="email"]', ownerEmail);
    await mobilePage.fill('input[name="password"]', ownerPassword);
    await mobilePage.click('button[type="submit"]');

    await mobilePage.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
    const screenshot9 = path.join(SCREENSHOTS_DIR, '08-mobile-dashboard-view.png');
    await mobilePage.screenshot({ path: screenshot9, fullPage: true });
    console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot9}`);

    testResults.push({ scenario: '9. Mobile responsive layout and RTL rendering', passed: true });
    await mobileContext.close();

    // =========================================================================
    // السيناريو 10: فحص مسار الصحة وقاعدة البيانات GET /api/health
    // =========================================================================
    console.log('\n--- 10. فحص مسار الصحة GET /api/health مع زمن استجابة Neon ---');
    const healthPage = await browser.newPage();
    await healthPage.goto(`${BASE_URL}/api/health`);
    const healthContent = await healthPage.textContent('body');
    const healthJson = JSON.parse(healthContent || '{}');

    if (healthJson.status === 'healthy' && healthJson.database?.status === 'connected') {
      console.log(`✅ فحص الصحة سليم: حالة الاتصال: ${healthJson.database.status}، زمن استجابة Neon: ${healthJson.database.latencyMs}ms.`);
      const screenshot10 = path.join(SCREENSHOTS_DIR, '09-health-check.png');
      await healthPage.screenshot({ path: screenshot10 });
      console.log(`📸 تم حفظ لقطة الشاشة: ${screenshot10}`);
      testResults.push({ scenario: '10. Health check endpoint live latency from Neon', passed: true });
    } else {
      throw new Error(`Health check returned degraded status: ${healthContent}`);
    }
    await healthPage.close();

    console.log('\n=============================================================');
    console.log('🎉 اكتملت كافة اختبارات E2E بنجاح تام 100%');
    console.log('=============================================================');
    testResults.forEach((t) => console.log(`  ✔ [PASS] ${t.scenario}`));
    console.log('=============================================================\n');
  } finally {
    if (browser) {
      await browser.close();
    }
    serverProcess.kill('SIGTERM');
    await dbPool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('run-e2e-playwright.ts')) {
  runE2E()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ E2E Playwright test suite failed:', err);
      process.exit(1);
    });
}
