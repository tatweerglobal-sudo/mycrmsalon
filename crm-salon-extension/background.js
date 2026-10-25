// background.js - My CRM Salon Extension Service Worker
// يتولى إرسال بيانات العميلات والمواعيد إلى الخادم بأمان ودون تخزين أي أسرار في الكود

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SEND_LEAD_TO_CRM') {
    handleSendLead(message.payload, message.config)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // إبقاء القناة مفتوحة للرد غير المتزامن
  }
});

async function handleSendLead(payload, config) {
  const { apiUrl, token } = config;

  if (!apiUrl) {
    return { ok: false, error: 'رابط الخادم غير محدد في إعدادات الإضافة.' };
  }
  if (!token) {
    return { ok: false, error: 'رمز الدخول (Bearer Token) غير محدد. يرجى إدخاله في الإعدادات.' };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      error: `تعذر الاتصال بالخادم: ${error.message}`,
    };
  }
}
