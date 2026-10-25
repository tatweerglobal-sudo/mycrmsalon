// content.js - My CRM Salon WhatsApp Contact Extractor v1.2
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

// تحويل الأرقام الهندية والفارسية إلى أرقام لاتينية قياسية
function convertArabicIndicDigits(input) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternPersian = '۰۱۲۳۴۵۶۷۸۹';
  return (input || '')
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternPersian.indexOf(d)));
}

// فحص موثوقية رقم الهاتف واستبعاد معرفات الأجهزة الداخلية لواتساب (LID)
function isValidRealPhoneNumber(str) {
  if (!str || typeof str !== 'string') return false;
  if (str.includes('@lid') || str.includes('lid')) return false;

  const cleaned = convertArabicIndicDigits(str);
  const digits = cleaned.replace(/\D/g, '');

  // استبعاد معرفات LID الداخلية لواتساب (14 إلى 16 رقماً تبدأ بـ 13 أو 14 أو 15)
  if (digits.length >= 14 && /^1[345]/.test(digits)) return false;
  if (digits.length < 8 || digits.length > 15) return false;

  // أرقام الجوال السعودية والخليجية (05XXXXXXXX أو 5XXXXXXXX)
  if (/^0?5\d{8}$/.test(digits)) return true;

  // أرقام الجوال المصرية (010, 011, 012, 015)
  if (/^01[0125]\d{8}$/.test(digits)) return true;

  // مفاتيح الدول العربية والدولية المعتمدة
  if (/^(966|20|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)\d{7,12}$/.test(digits)) return true;

  return digits.length >= 8 && digits.length <= 14;
}

// تنظيف وتنسيق الرقم وحذف المسافات الداخلية والرموز الخفية
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

  // السعودية: 05XXXXXXXX -> +9665XXXXXXXX
  if (/^05\d{8}$/.test(digits)) return '+966' + digits.slice(1);
  if (/^5\d{8}$/.test(digits)) return '+966' + digits;
  if (/^9665\d{8}$/.test(digits)) return '+' + digits;

  // مصر: 01XXXXXXXXX -> +201XXXXXXXXX
  if (/^01[0125]\d{8}$/.test(digits)) return '+20' + digits.slice(1);
  if (/^201[0125]\d{8}$/.test(digits)) return '+' + digits;

  // الإمارات وباقي الخليج
  if (/^9715\d{8}$/.test(digits)) return '+' + digits;
  if (/^965\d{8}$/.test(digits)) return '+' + digits;

  if (digits.length >= 8 && digits.length <= 15) {
    if (/^(966|20|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)/.test(digits)) {
      return '+' + digits;
    }
  }

  return '+' + digits;
}

// البحث عن رقم هاتف صالح داخل أي عنصر DOM
function findPhoneInElement(rootEl) {
  if (!rootEl) return null;

  const intlRegex = /(?:\+|00)\s*(?:966|20|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|\d{1,3})[\d\s\-()]{7,15}\d/;
  const saudiRegex = /\b0?5\d[\d\s\-]{7,9}\d\b/;
  const egyptRegex = /\b01[0125][\d\s\-]{8}\b/;

  const nodes = rootEl.querySelectorAll('span, div, a, p');
  for (const node of nodes) {
    const title = (node.getAttribute('title') || '').trim();
    if (title) {
      const m = title.match(intlRegex) || title.match(saudiRegex) || title.match(egyptRegex);
      if (m && isValidRealPhoneNumber(m[0])) {
        return m[0].trim();
      }
    }

    if (node.children.length <= 1) {
      const txt = (node.textContent || '').trim();
      if (txt && txt.length >= 8 && txt.length <= 30) {
        const m = txt.match(intlRegex) || txt.match(saudiRegex) || txt.match(egyptRegex);
        if (m && isValidRealPhoneNumber(m[0])) {
          return m[0].trim();
        }
      }
    }
  }

  const telLink = rootEl.querySelector('a[href^="tel:"]');
  if (telLink) {
    const href = telLink.getAttribute('href') || '';
    const phoneFromHref = href.replace('tel:', '').trim();
    if (isValidRealPhoneNumber(phoneFromHref)) {
      return phoneFromHref;
    }
  }

  return null;
}

// فتح وقراءة درج معلومات جهة الاتصال (Contact Info Drawer) الموثوق 100%
async function readPhoneByOpeningContactDrawer(mainHeader) {
  try {
    let drawer =
      document.querySelector('[data-testid="contact-info-drawer"]') ||
      document.querySelector('div[data-testid="drawer-middle"]') ||
      document.querySelector('div[aria-label*="معلومات"]') ||
      document.querySelector('div[aria-label*="Contact"]') ||
      document.querySelector('div[role="region"]') ||
      document.querySelector('section');

    let alreadyOpen = false;
    if (drawer) {
      const p = findPhoneInElement(drawer);
      if (p) return p;
      alreadyOpen = true;
    }

    // العثور على زر الترويسة لفتح معلومات جهة الاتصال
    const titleContainer =
      mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]')?.closest('div[role="button"]') ||
      mainHeader.querySelector('span[title]')?.closest('div[role="button"]') ||
      mainHeader.querySelector('div[role="button"]') ||
      mainHeader;

    if (!alreadyOpen && titleContainer) {
      titleContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      titleContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      titleContainer.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      titleContainer.click();
    }

    // فحص دوري حتى 1400ms لظهور الرقم داخل الدرج
    let foundPhone = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      await new Promise((r) => setTimeout(r, 100));

      drawer =
        document.querySelector('[data-testid="contact-info-drawer"]') ||
        document.querySelector('div[data-testid="drawer-middle"]') ||
        document.querySelector('div[aria-label*="معلومات"]') ||
        document.querySelector('div[aria-label*="Contact"]') ||
        document.querySelector('div[role="region"]') ||
        document.querySelector('section');

      if (drawer) {
        foundPhone = findPhoneInElement(drawer);
        if (foundPhone) break;
      }
    }

    // إغلاق الدرج فوراً إذا قمنا بفتحه
    if (!alreadyOpen && drawer) {
      const closeBtn =
        drawer.querySelector('button[aria-label*="Close"], button[aria-label*="إغلاق"], span[data-testid="x"]')?.closest('button') ||
        drawer.querySelector('button');
      if (closeBtn) {
        closeBtn.click();
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      }
    }

    return foundPhone;
  } catch (_e) {
    return null;
  }
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
        error: 'لم يتم العثور على محادثة مفتوحة حالياً. يرجى فتح محادثة العميل/ة في واتساب ويب أولاً.',
      };
    }

    // 2. العثور على ترويسة المحادثة
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

    // 3. استخراج العنوان الأساسي والاسم المستعار
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

    // 4. إذا كان العنوان نفسه هو رقم هاتف حقيقي
    if (isValidRealPhoneNumber(headerTitle)) {
      phone = headerTitle.trim();
      name = pushName || (headerSubtitle && !isValidRealPhoneNumber(headerSubtitle) ? headerSubtitle : '');
    } else {
      // جهة الاتصال مسجلة باسم العميل
      name = headerTitle.trim();

      // فحص العنوان الفرعي
      if (headerSubtitle && isValidRealPhoneNumber(headerSubtitle)) {
        phone = headerSubtitle.trim();
      }

      // الاستراتيجية 1: فحص فقاعات الرسائل في المحادثة data-id
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

      // الاستراتيجية 2: فحص الصور وعناصر الـ JID بالترويسة
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

      // الاستراتيجية 3 (الأقوى والأضمن): فتح وقراءة درج معلومات جهة الاتصال (Contact Info Drawer)
      if (!phone) {
        phone = await readPhoneByOpeningContactDrawer(mainHeader);
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
        error: 'تعذر قراءة بيانات المحادثة. يرجى التأكد من فتح محادثة العميل/ة في واتساب ويب.',
      };
    }

    return {
      ok: true,
      name: name || '',
      phone: phone || '',
      data: {
        name: name || '',
        phone: phone || '',
      },
    };
  } catch (err) {
    return { ok: false, error: `فشل قراءة بيانات العميل/ة: ${err.message}` };
  }
}
