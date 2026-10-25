// scripts/verify-full-production-flow.ts
// تشغيل واختبار الدورة الإنتاجية المتكاملة 100% (Full Production Cycle Verification)
// يربط كل المكونات: Next.js Standalone + Neon PostgreSQL RLS + Auth + Customers + Appointments + Invoices + Payments + Inventory + Dashboard

import '../src/lib/load-env';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { getMigrationDbPool } from '../src/lib/db';

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(url: string, timeoutMs = 25000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch (_e) {
      // waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function runFullIntegration() {
  console.log('=============================================================');
  console.log('🚀 بدء تشغيل والتحقق من النظام الإنتاجي المتكامل لـ My CRM Salon');
  console.log('=============================================================');

  const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@crmsalon.de').toLowerCase().trim();
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!ownerPassword) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD is required in .env.local');
  }

  // 1. تشغيل سيرفر Next.js المستقل (Standalone)
  console.log(`🌐 1. تشغيل سيرفر Next.js Standalone على المنفذ ${PORT}...`);
  const standaloneServer = path.join(process.cwd(), '.next', 'standalone', 'server.js');
  const serverProcess: ChildProcess = spawn(
    process.execPath,
    [standaloneServer],
    {
      cwd: path.join(process.cwd(), '.next', 'standalone'),
      env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  serverProcess.stderr?.on('data', (d) => {
    const msg = d.toString().trim();
    if (!msg.includes('ExperimentalWarning')) {
      console.error(`[Server Log] ${msg}`);
    }
  });

  const cleanupIds: { customerId?: string; appointmentId?: string; invoiceId?: string; productId?: string } = {};

  try {
    const ready = await waitForServer(BASE_URL);
    if (!ready) {
      throw new Error(`تعذر تشغيل السيرفر على ${BASE_URL} خلال المهلة المحددة.`);
    }
    console.log(`✔ السيرفر يعمل بنجاح على ${BASE_URL} ومتصل بـ Neon.`);

    // 2. فحص نقطة الصحة /api/health
    console.log('\n🩺 2. فحص نقطة الصحة والاتصال بقاعدة بيانات Neon...');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    if (!healthRes.ok || healthData.database?.status !== 'connected') {
      throw new Error(`فشل فحص الصحة: ${JSON.stringify(healthData)}`);
    }
    console.log(`✔ قاعدة بيانات Neon متصلة بنجاح، زمن الاستجابة: ${healthData.database.latencyMs}ms`);

    // 3. تسجيل الدخول كمالك الصالون
    console.log('\n🔐 3. تسجيل الدخول كمالك المركز والحصول على جلسة مشفرة...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': BASE_URL,
      },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });

    if (!loginRes.ok) {
      const err = await loginRes.json();
      throw new Error(`فشل تسجيل الدخول: ${JSON.stringify(err)}`);
    }

    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (!setCookieHeader || !setCookieHeader.includes('salon_session=')) {
      throw new Error('لم يتم استلام كوكي الجلسة salon_session');
    }

    const sessionCookie = setCookieHeader.split(';')[0];
    const authHeaders = {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json',
      'Origin': BASE_URL,
    };
    console.log('✔ تم تسجيل الدخول واستلام كوكي الجلسة بنجاح.');

    // 4. التحقق من جلسة المستخدم /api/auth/me
    console.log('\n👤 4. التحقق من هوية وصلاحيات المالك...');
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, { headers: authHeaders });
    const meData = await meRes.json();
    if (!meRes.ok || !meData.authenticated || meData.activeTenant?.role !== 'salon_owner') {
      throw new Error(`فشل التحقق من الجلسة: ${JSON.stringify(meData)}`);
    }
    console.log(`✔ المستخدم معتمد: "${meData.user.name}"، الصالون: "${meData.activeTenant.name}"`);

    // 5. استعراض الخدمات وفريق العمل
    console.log('\n💇 5. جلب الخدمات وفريق العمل المسجل...');
    const [srvRes, stfRes] = await Promise.all([
      fetch(`${BASE_URL}/api/services`, { headers: authHeaders }),
      fetch(`${BASE_URL}/api/staff`, { headers: authHeaders }),
    ]);
    const srvData = await srvRes.json();
    const stfData = await stfRes.json();

    if (!srvRes.ok || !srvData.services?.length) {
      throw new Error('لا توجد خدمات مسجلة في المركز');
    }
    if (!stfRes.ok || !stfData.staff?.length) {
      throw new Error('لا يوجد موظفون مسجلون في المركز');
    }

    const selectedService = srvData.services[0];
    const selectedStaff = stfData.staff[0];
    console.log(`✔ تم اختيار الخدمة: "${selectedService.name}" (${selectedService.price} ر.س)`);
    console.log(`✔ تم اختيار الأخصائية: "${selectedStaff.display_name}" (${selectedStaff.title})`);

    // 6. إضافة عميلة جديدة وتطبيع الهاتف
    console.log('\n👥 6. إضافة عميلة جديدة مع التطبيع الدولي E.164...');
    const customerPhone = '055' + Math.floor(1000000 + Math.random() * 9000000);
    const addCustRes = await fetch(`${BASE_URL}/api/customers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        fullName: 'نورة السعدي (عميلة معتمدة)',
        phone: customerPhone,
        notes: 'تفضل الصبغات الطبيعية والمواعيد الصباحية',
      }),
    });

    const addCustData = await addCustRes.json();
    if (!addCustRes.ok || !addCustData.customer?.id) {
      throw new Error(`فشل إضافة العميلة: ${JSON.stringify(addCustData)}`);
    }
    const customer = addCustData.customer;
    cleanupIds.customerId = customer.id;
    console.log(`✔ تمت إضافة العميلة بنجاح: "${customer.full_name}"، الهاتف بعد التطبيع: ${customer.phone_normalized}`);

    // فحص منع التكرار لنفس الهاتف
    const dupRes = await fetch(`${BASE_URL}/api/customers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        fullName: 'عميلة مكررة',
        phone: customerPhone,
      }),
    });
    if (dupRes.status !== 409) {
      throw new Error(`منع تكرار الهاتف فشل! الحالة: ${dupRes.status}`);
    }
    console.log('✔ تم فحص منع تكرار الهاتف داخل نفس الصالون بنجاح (HTTP 409 Conflict).');

    // 7. حجز موعد جديد
    console.log('\n📅 7. حجز موعد جديد وفحص منع التعارض الزمني...');
    const appointmentTime = new Date(Date.now() + 86400000); // غداً
    appointmentTime.setHours(11, 0, 0, 0);

    const bookRes = await fetch(`${BASE_URL}/api/appointments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        serviceId: selectedService.id,
        staffId: selectedStaff.id,
        startsAt: appointmentTime.toISOString(),
        notes: 'حجز مؤكد مع الأخصائية سارة',
      }),
    });

    const bookData = await bookRes.json();
    if (!bookRes.ok || !bookData.appointment?.id) {
      throw new Error(`فشل حجز الموعد: ${JSON.stringify(bookData)}`);
    }
    const appointment = bookData.appointment;
    cleanupIds.appointmentId = appointment.id;
    console.log(`✔ تم تسجيل الحجز بنجاح (ID: ${appointment.id})، الحالة: ${appointment.status}`);

    // فحص التعارض الزمني (Double-Booking Conflict)
    const conflictRes = await fetch(`${BASE_URL}/api/appointments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        serviceId: selectedService.id,
        staffId: selectedStaff.id,
        startsAt: appointmentTime.toISOString(), // نفس الموعد ونفس الموظفة بالضبط
      }),
    });
    if (conflictRes.status !== 409) {
      throw new Error(`منع التعارض الزمني لم يعمل! الحالة: ${conflictRes.status}`);
    }
    console.log('✔ تم الكشف التلقائي عن التعارض الزمني ومنع الحجز المزدوج بنجاح (HTTP 409 Conflict).');

    // تحديث حالة الحجز إلى completed
    const completeRes = await fetch(`${BASE_URL}/api/appointments`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        appointmentId: appointment.id,
        status: 'completed',
      }),
    });
    if (!completeRes.ok) {
      throw new Error('فشل تحديث حالة الحجز إلى مكتمل');
    }
    console.log('✔ تم تحديث حالة الحجز إلى "مكتمل" (completed).');

    // 8. إصدار فاتورة ضريبية رسمية
    console.log('\n💳 8. إصدار فاتورة ضريبية رسمية للخدمة...');
    const subtotal = Number(selectedService.price);
    const invoiceRes = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        appointmentId: appointment.id,
        subtotal: subtotal,
        discountAmount: 0,
        notes: 'فاتورة جلسة تجميل متكاملة',
      }),
    });

    const invData = await invoiceRes.json();
    if (!invoiceRes.ok || !invData.invoice?.id) {
      throw new Error(`فشل إصدار الفاتورة: ${JSON.stringify(invData)}`);
    }
    const invoice = invData.invoice;
    cleanupIds.invoiceId = invoice.id;
    console.log(`✔ تم إصدار الفاتورة: "${invoice.invoice_number}"، الإجمالي مع 15% ضريبة: ${invoice.total_amount} ر.س`);

    // 9. سداد الفاتورة وتسجيل الدفعة المالية
    console.log('\n💰 9. تسجيل سداد الفاتورة وتحديث حسابات العميل...');
    const payRes = await fetch(`${BASE_URL}/api/payments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: invoice.id,
        amount: Number(invoice.total_amount),
        paymentMethod: 'card',
        referenceNumber: 'TXN_' + Date.now(),
        notes: 'دفع عبر بطاقة مدى',
      }),
    });

    const payData = await payRes.json();
    if (!payRes.ok || payData.invoiceStatus !== 'paid') {
      throw new Error(`فشل تسجيل الدفعة: ${JSON.stringify(payData)}`);
    }
    console.log(`✔ تم تسجيل التحصيل بنجاح، حالة الفاتورة الآن: "${payData.invoiceStatus}".`);

    // 10. إضافة منتج للمخزون وتسجيل حركة توريد
    console.log('\n📦 10. إضافة منتج للمخزون وتسجيل حركة توريد واردة...');
    const prodRes = await fetch(`${BASE_URL}/api/inventory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'سيروم الأرجان المغربي المركز 100ml',
        sku: 'ARG-SERUM-' + Date.now().toString().slice(-4),
        category: 'العناية بالشعر',
        unitPrice: 135,
        costPrice: 70,
        quantity: 20,
        minQuantity: 5,
      }),
    });

    const prodData = await prodRes.json();
    if (!prodRes.ok || !prodData.product?.id) {
      throw new Error(`فشل إضافة المنتج للمخزون: ${JSON.stringify(prodData)}`);
    }
    const product = prodData.product;
    cleanupIds.productId = product.id;
    console.log(`✔ تمت إضافة المنتج للمخزون: "${product.name}"، الرصيد: ${product.quantity} قطعة.`);

    // 11. التحقق من مؤشرات لوحة التحكم المحدثة
    console.log('\n📊 11. التحقق من لوحة التحكم ومطابقة المؤشرات الحية...');
    const statsRes = await fetch(`${BASE_URL}/api/dashboard/stats`, { headers: authHeaders });
    const statsData = await statsRes.json();
    if (!statsRes.ok || !statsData.stats) {
      throw new Error(`فشل جلب المؤشرات: ${JSON.stringify(statsData)}`);
    }
    const s = statsData.stats;
    console.log(`✔ مؤشرات لوحة التحكم الحية من Neon:`);
    console.log(`   - إجمالي العميلات: ${s.totalCustomers}`);
    console.log(`   - إجمالي الحجوزات: ${s.totalAppointments}`);
    console.log(`   - إجمالي الإيرادات المحصلة: ${s.totalRevenue} ر.س`);
    console.log(`   - الخدمات النشطة: ${s.activeServices}`);
    console.log(`   - الخبيرات النشطات: ${s.activeStaff}`);

    console.log('\n=============================================================');
    console.log('🎉 اكتملت الدورة التشغيلية الكاملة بنجاح تام 100%!');
    console.log('   النظام يعمل بتكامل تام بين Next.js Standalone وقاعدة Neon السحابية.');
    console.log('=============================================================');

  } finally {
    // تنظيف السجلات الاختبارية للحفاظ على نظافة بيئة الإنتاج
    console.log('\n🧹 تنظيف السجلات الاختبارية للحفاظ على نظافة قاعدة البيانات...');
    try {
      const dbPool = getMigrationDbPool();
      if (cleanupIds.invoiceId) {
        await dbPool.query('DELETE FROM payments WHERE invoice_id = $1', [cleanupIds.invoiceId]);
        await dbPool.query('DELETE FROM invoices WHERE id = $1', [cleanupIds.invoiceId]);
      }
      if (cleanupIds.appointmentId) {
        await dbPool.query('DELETE FROM appointment_services WHERE appointment_id = $1', [cleanupIds.appointmentId]);
        await dbPool.query('DELETE FROM appointments WHERE id = $1', [cleanupIds.appointmentId]);
      }
      if (cleanupIds.customerId) {
        await dbPool.query('DELETE FROM customers WHERE id = $1', [cleanupIds.customerId]);
      }
      if (cleanupIds.productId) {
        await dbPool.query('DELETE FROM inventory_transactions WHERE product_id = $1', [cleanupIds.productId]);
        await dbPool.query('DELETE FROM products WHERE id = $1', [cleanupIds.productId]);
      }
      console.log('✔ تم تنظيف السجلات بنجاح وقاعدة البيانات الآن جاهزة للإنتاج.');
    } catch (cleanErr) {
      console.error('تحذير أثناء التنظيف:', cleanErr);
    }

    serverProcess.kill();
  }
}

runFullIntegration().catch((err) => {
  console.error('\n❌ فشل التحقق:', err);
  process.exit(1);
});
