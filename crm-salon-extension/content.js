// content.js - My CRM Salon WhatsApp Contact Extractor v1.1
// خصوصية وأمان: يلتقط فقط الاسم ورقم الهاتف الظاهرين في رأس المحادثة النشطة بعد إجراء المستخدم
// يُحظر تماماً قراءة أو تتبع نصوص أو محتوى المحادثات

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CAPTURE_ACTIVE_CONTACT') {
    extractActiveContactInfo()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // إبقاء القناة مفتوحة للرد غير المتزامن
  }
});

// فحص موثوقية رقم الهاتف واستبعاد معرفات الأجهزة الداخلية لواتساب (LID)
function isValidRealPhoneNumber(str) {
  if (!str || typeof str !== 'string') return false;
  if (str.includes('@lid') || str.includes('lid')) return false;

  const cleaned = convertArabicIndicDigits(str);
  const digits = cleaned.replace(/\D/g, '');

  // استبعاد معرفات LID الداخلية لواتساب (14 إلى 16 رقماً تبدأ بـ 13 أو 14 أو 15)
  if (digits.length >= 14 && /^1[345]/.test(digits)) return false;
  if (digits.length < 8 || digits.length > 15) return false;

  // الأرقام السعودية والخليجية (05XXXXXXXX أو 5XXXXXXXX)
  if (/^0?5\d{8}$/.test(digits)) return true;

  // الأرقام المصرية المحلية (010, 011, 012, 015)
  if (/^01[0125]\d{8}$/.test(digits)) return true;

  // مفاتيح الدول العربية والدولية المعتمدة
  if (/^(966|20|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)\d{7,12}$/.test(digits)) return true;

  return digits.length >= 8 && digits.length <= 14;
}

// تحويل الأرقام الهندية والفارسية إلى أرقام لاتينية
function convertArabicIndicDigits(input) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternPersian = '۰۱۲۳۴۵۶۷۸۹';
  return (input || '')
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternPersian.indexOf(d)));
}

// تنظيف وتنسيق الرقم وحذف المسافات الداخلية ورموز اتجاه النص BiDi
function cleanAndFormatPhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  let str = convertArabicIndicDigits(rawPhone)
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();

  const hasPlus = str.startsWith('+') || str.startsWith('00');
  const digits = str.replace(/\D/g, '');

  if (hasPlus) {
    if (str.startsWith('00')) return '+' + digits.slice(2);
    return '+' + digits;
  }

  // أرقام الجوال السعودية: 05XXXXXXXX أو 5XXXXXXXX
  if (/^05\d{8}$/.test(digits)) return '+966' + digits.slice(1);
  if (/^5\d{8}$/.test(digits)) return '+966' + digits;
  if (/^9665\d{8}$/.test(digits)) return '+' + digits;

  // أرقام الجوال المصرية: 01XXXXXXXXX
  if (/^01[0125]\d{8}$/.test(digits)) return '+20' + digits.slice(1);
  if (/^201[0125]\d{8}$/.test(digits)) return '+' + digits;

  // أرقام الإمارات وباقي الخليج
  if (/^9715\d{8}$/.test(digits)) return '+' + digits;
  if (/^965\d{8}$/.test(digits)) return '+' + digits;

  if (digits.length >= 8 && digits.length <= 15) {
    if (/^(966|20|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)/.test(digits)) {
      return '+' + digits;
    }
  }

  return '+' + digits;
}

async function extractActiveContactInfo() {
  try {
    // 1. التحقق من وجود لوحة المحادثة النشطة في واتساب ويب
    const mainContainer =
      document.querySelector('#main') ||
      document.querySelector('div[data-testid="conversation-panel-body"]') ||
      document.querySelector('div[role="region"]');

    if (!mainContainer) {
      return {
        ok: false,
        error: 'لم يتم العثور على محادثة مفتوحة حالياً. يرجى النقر على محادثة العميل/ة في واتساب ويب لفتحها أولاً.',
      };
    }

    // 2. العثور على ترويسة المحادثة النشطة (Active Chat Header)
    const mainHeader =
      mainContainer.querySelector('header') ||
      document.querySelector('[data-testid="conversation-info-header"]') ||
      document.querySelector('#main header');

    if (!mainHeader) {
      return {
        ok: false,
        error: 'تعذر تحديد ترويسة المحادثة في واتساب ويب. تأكد من اكتمال تحميل الصفحة.',
      };
    }

    // 3. استخراج عنوان وترويسة المحادثة والاسم المستعار (PushName)
    const titleCandidates = [
      mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]'),
      mainHeader.querySelector('div[role="button"] span[title]'),
      mainHeader.querySelector('span[title]'),
      mainHeader.querySelector('div[role="button"] span[dir="auto"]'),
      mainHeader.querySelector('span[dir="auto"]'),
    ];

    let headerTitle = '';
    for (const el of titleCandidates) {
      if (el) {
        const val = (el.getAttribute('title') || el.textContent || '').trim();
        if (val && val.length > 0 && !val.includes('menu') && !val.includes('search')) {
          headerTitle = val;
          break;
        }
      }
    }

    // فحص نصوص العنوان الفرعي والاسم المستعار ~pushName
    let pushName = '';
    let headerSubtitle = '';
    const headerSpans = mainHeader.querySelectorAll('span[dir="auto"], span[title], div[dir="auto"]');
    for (const el of headerSpans) {
      const txt = (el.getAttribute('title') || el.textContent || '').trim();
      if (!txt || txt === headerTitle) continue;
      if (['online', 'typing...', 'متصل الآن', 'يكتب...', 'جاري الكتابة...'].includes(txt.toLowerCase())) continue;

      if (txt.startsWith('~')) {
        pushName = txt.replace(/^~/, '').trim();
      } else if (!headerSubtitle && txt.length > 1 && txt.length < 50) {
        headerSubtitle = txt;
      }
    }

    let name = '';
    let phone = '';

    // 4. تحديد ما إذا كان العنوان هو رقم الهاتف أم اسم العميل
    if (isValidRealPhoneNumber(headerTitle)) {
      // الحالة الأولى: جهة الاتصال غير مسجلة بالاسم ورقم الهاتف ظاهر مباشرة في العنوان
      phone = headerTitle.trim();
      name = pushName || (headerSubtitle && !isValidRealPhoneNumber(headerSubtitle) ? headerSubtitle : '');
    } else {
      // الحالة الثانية: جهة الاتصال مسجلة بالاسم في جهات الاتصال
      name = headerTitle.trim();

      // فحص العنوان الفرعي أولاً
      if (headerSubtitle && isValidRealPhoneNumber(headerSubtitle)) {
        phone = headerSubtitle.trim();
      }

      // الاستراتيجية 1 (الأقوى والأضمن): قراءة معرفات رسائل المحادثة (data-id)
      // كل فقاعة رسالة في واتساب ويب تحتوي على معرف بصيغة: false_9665XXXXXXXX@c.us_...
      if (!phone) {
        const msgEls = mainContainer.querySelectorAll('div[data-id]');
        for (const el of msgEls) {
          const dataId = el.getAttribute('data-id') || '';
          const match = dataId.match(/(?:true|false)_(\d{8,14})@c\.us/);
          if (match && isValidRealPhoneNumber(match[1])) {
            phone = '+' + match[1];
            break;
          }
        }
      }

      // الاستراتيجية 2: البحث في صورة الحساب الشخصية بالترويسة (Avatar URL)
      if (!phone) {
        const images = mainHeader.querySelectorAll('img');
        for (const img of images) {
          const src = img.getAttribute('src') || '';
          const match =
            src.match(/[?&]u=(\d{8,14})(?:%40|@)c\.us/) ||
            src.match(/\b(\d{8,14})%40c\.us/) ||
            src.match(/\b(\d{8,14})@c\.us/);
          if (match && isValidRealPhoneNumber(match[1])) {
            phone = '+' + match[1];
            break;
          }
        }
      }

      // الاستراتيجية 3: فحص المحادثة النشطة في القائمة الجانبية (#pane-side)
      if (!phone) {
        const activeSideChat =
          document.querySelector('#pane-side div[aria-selected="true"]') ||
          document.querySelector('#pane-side div[tabindex="0"]');
        if (activeSideChat) {
          const sideImgs = activeSideChat.querySelectorAll('img');
          for (const img of sideImgs) {
            const src = img.getAttribute('src') || '';
            const match =
              src.match(/[?&]u=(\d{8,14})(?:%40|@)c\.us/) ||
              src.match(/\b(\d{8,14})%40c\.us/);
            if (match && isValidRealPhoneNumber(match[1])) {
              phone = '+' + match[1];
              break;
            }
          }
        }
      }

      // الاستراتيجية 4: فحص سمات عناصر المحادثة عن JID جهة الاتصال (@c.us وتجاهل @lid)
      if (!phone) {
        const elements = mainContainer.querySelectorAll('*');
        for (const el of elements) {
          for (const attr of el.attributes) {
            if (attr.value && attr.value.includes('@c.us') && !attr.value.includes('@lid') && !attr.value.includes('@g.us')) {
              const match = attr.value.match(/(\d{8,14})@c\.us/);
              if (match && isValidRealPhoneNumber(match[1])) {
                phone = '+' + match[1];
                break;
              }
            }
          }
          if (phone) break;
        }
      }

      // الاستراتيجية 5: فحص بنية React Fiber لشجرة المكونات
      if (!phone) {
        try {
          phone = scanReactFiberForPhone(mainContainer) || scanReactFiberForPhone(mainHeader);
        } catch (_e) {}
      }

      // الاستراتيجية 6: فتح وقراءة لوحة معلومات جهة الاتصال (Contact Info Drawer)
      if (!phone) {
        try {
          const drawerPhone = await readPhoneFromContactDrawer(mainHeader);
          if (drawerPhone && isValidRealPhoneNumber(drawerPhone)) {
            phone = drawerPhone;
          }
        } catch (_e) {}
      }
    }

    // تنظيف وتنسيق الرقم النهائي
    if (phone && isValidRealPhoneNumber(phone)) {
      phone = cleanAndFormatPhoneNumber(phone);
    } else {
      phone = '';
    }

    if (!name && !phone) {
      return {
        ok: false,
        error: 'تعذر قراءة بيانات المحادثة. يرجى التأكد من فتح محادثة العميل/ة بوضوح في واتساب ويب.',
      };
    }

    let warning;
    if (name && !phone) {
      warning = `تم التقاط اسم العميل/ة ("${name}")؛ يرجى كتابة رقم الهاتف يدوياً في الخانة نظراً لخصوصية الحساب.`;
    }

    return {
      ok: true,
      name: name || '',
      phone: phone || '',
      data: {
        name: name || '',
        phone: phone || '',
      },
      warning,
    };
  } catch (err) {
    return { ok: false, error: `فشل قراءة بيانات العميل/ة: ${err.message}` };
  }
}

// دالة فحص React Fiber لشجرة المكونات مع حظر صارم لمعرفات LID
function scanReactFiberForPhone(domNode) {
  if (!domNode) return null;
  try {
    const keys = Object.keys(domNode);
    const fiberKey = keys.find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    const propsKey = keys.find((k) => k.startsWith('__reactProps$'));

    if (propsKey && domNode[propsKey]) {
      const p = inspectPropsObject(domNode[propsKey]);
      if (p) return p;
    }

    if (fiberKey && domNode[fiberKey]) {
      let fiber = domNode[fiberKey];
      let depth = 0;
      while (fiber && depth < 40) {
        if (fiber.memoizedProps) {
          const p = inspectPropsObject(fiber.memoizedProps);
          if (p) return p;
        }
        if (fiber.memoizedState) {
          const p = inspectPropsObject(fiber.memoizedState);
          if (p) return p;
        }
        fiber = fiber.return;
        depth++;
      }
    }
  } catch (_e) {}
  return null;
}

function inspectPropsObject(obj, visited = new Set(), depth = 0) {
  if (!obj || depth > 5 || typeof obj !== 'object' || visited.has(obj)) return null;
  visited.add(obj);

  try {
    if (typeof obj.phoneNumber === 'string' && isValidRealPhoneNumber(obj.phoneNumber)) {
      return obj.phoneNumber.trim();
    }

    if (obj.pnId && typeof obj.pnId === 'object') {
      if (obj.pnId.server === 'c.us' && obj.pnId.user && isValidRealPhoneNumber(obj.pnId.user)) {
        return '+' + obj.pnId.user;
      }
      if (typeof obj.pnId._serialized === 'string' && obj.pnId._serialized.endsWith('@c.us')) {
        const m = obj.pnId._serialized.match(/^(\d{8,14})@c\.us$/);
        if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
      }
    }

    if (obj.id && typeof obj.id === 'object' && obj.id.server !== 'lid') {
      if ((obj.id.server === 'c.us' || obj.id.server === 's.whatsapp.net') && obj.id.user) {
        if (isValidRealPhoneNumber(obj.id.user)) return '+' + obj.id.user;
      }
      if (typeof obj.id._serialized === 'string' && obj.id._serialized.endsWith('@c.us')) {
        const m = obj.id._serialized.match(/^(\d{8,14})@c\.us$/);
        if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
      }
    }

    if (typeof obj._serialized === 'string' && (obj._serialized.endsWith('@c.us') || obj._serialized.endsWith('@s.whatsapp.net'))) {
      const m = obj._serialized.match(/^(\d{8,14})@(c\.us|s\.whatsapp\.net)$/);
      if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
    }

    if (typeof obj.jid === 'string' && (obj.jid.endsWith('@c.us') || obj.jid.endsWith('@s.whatsapp.net'))) {
      const m = obj.jid.match(/^(\d{8,14})@(c\.us|s\.whatsapp\.net)$/);
      if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
    }

    for (const k of ['contact', 'chat', 'pnId', 'user', 'sender', 'author']) {
      if (obj[k]) {
        const res = inspectPropsObject(obj[k], visited, depth + 1);
        if (res) return res;
      }
    }
  } catch (_e) {}

  return null;
}

// دالة فتح وقراءة لوحة معلومات جهة الاتصال (Contact Info Drawer)
async function readPhoneFromContactDrawer(mainHeader) {
  try {
    let drawer =
      document.querySelector('[data-testid="contact-info-drawer"]') ||
      document.querySelector('div[role="region"][aria-label*="Contact"]') ||
      document.querySelector('div[role="region"][aria-label*="جهة"]') ||
      document.querySelector('div[role="region"][aria-label*="معلومات"]') ||
      document.querySelector('section');

    let opened = false;
    if (!drawer) {
      const titleClickEl =
        mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]')?.closest('div[role="button"]') ||
        mainHeader.querySelector('span[title]')?.closest('div[role="button"]') ||
        mainHeader.querySelector('span[dir="auto"]')?.closest('div[role="button"]') ||
        mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
        mainHeader.querySelector('span[title]');

      if (titleClickEl) {
        titleClickEl.click();
        opened = true;
        await new Promise((r) => setTimeout(r, 250));
        drawer =
          document.querySelector('[data-testid="contact-info-drawer"]') ||
          document.querySelector('div[role="region"][aria-label*="Contact"]') ||
          document.querySelector('div[role="region"][aria-label*="جهة"]') ||
          document.querySelector('div[role="region"][aria-label*="معلومات"]') ||
          document.querySelector('section');
      }
    }

    if (drawer) {
      const intlRegex = /(?:\+|00)\s*(?:20|966|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|\d{1,3})\s*[\d\s\-()]{7,13}\d/;
      const localRegex = /\b0?[15][\d\s\-]{8,10}\b/;
      const textEls = drawer.querySelectorAll('span, div');
      let foundPhone = null;

      for (const el of textEls) {
        const txt = (el.getAttribute('title') || el.textContent || '').trim();
        const m = txt.match(intlRegex) || txt.match(localRegex);
        if (m && isValidRealPhoneNumber(m[0])) {
          foundPhone = m[0].trim();
          break;
        }
      }

      if (opened) {
        const closeBtn =
          drawer.querySelector('button[aria-label*="Close"], button[aria-label*="إغلاق"], span[data-testid="x"]')?.closest('button') ||
          drawer.querySelector('button');
        if (closeBtn) closeBtn.click();
      }

      const mediaCloseBtn = document.querySelector(
        '[data-testid="media-viewer"] button, button[aria-label*="Close photo"], button[aria-label*="إغلاق الصورة"]'
      );
      if (mediaCloseBtn) mediaCloseBtn.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));

      return foundPhone;
    }
  } catch (_e) {}
  return null;
}
