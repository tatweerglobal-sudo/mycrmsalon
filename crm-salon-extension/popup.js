// popup.js - Controller for My CRM Salon Synchronized Extension v1.0
// My CRM Salon is the Single Source of Truth for Services, Statuses, Staff, and Tags

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const form = document.getElementById('leadForm');
  const alertBox = document.getElementById('alertBox');
  const btnCapture = document.getElementById('btnCaptureActive');
  const btnSubmit = document.getElementById('btnSubmit');

  const btnSyncNow = document.getElementById('btnSyncNow');
  const syncStatusText = document.getElementById('syncStatusText');
  const syncStatusDot = document.getElementById('syncStatusDot');
  const cacheBanner = document.getElementById('cacheBanner');
  const cacheTimeText = document.getElementById('cacheTimeText');
  const jobsCountBadge = document.getElementById('jobsCountBadge');

  const toggleSettings = document.getElementById('toggleSettings');
  const settingsBox = document.getElementById('settingsBox');
  const apiUrlInput = document.getElementById('apiUrl');
  const apiTokenInput = document.getElementById('apiToken');
  const btnSaveApiSettings = document.getElementById('btnSaveApiSettings');

  // Input & Select elements
  const phoneInput = document.getElementById('phone');
  const nameInput = document.getElementById('name');
  const jobSelect = document.getElementById('job');
  const customJobInput = document.getElementById('customJobInput');
  const customJobNotice = document.getElementById('customJobNotice');
  const statusSelect = document.getElementById('status');
  const employeeSelect = document.getElementById('employee');
  const tagsCountBadge = document.getElementById('tagsCountBadge');
  const tagsContainer = document.getElementById('tagsContainer');
  const customTagInput = document.getElementById('customTagInput');
  const btnAddCustomTag = document.getElementById('btnAddCustomTag');
  const customTagsNotice = document.getElementById('customTagsNotice');
  const interviewedCheck = document.getElementById('interviewed');
  const followUpDateInput = document.getElementById('followUpDate');
  const interviewDateInput = document.getElementById('interviewDate');
  const notesInput = document.getElementById('notes');

  // State
  let state = {
    apiUrl: 'https://crmsalon.de/api/v1/extension/capture',
    token: '',
    jobs: [],
    statuses: [],
    employees: [],
    tags: [],
    selectedTags: [],
    customTags: [],
    currentEmployee: null,
    version: '',
    lastSyncTime: '',
    isOfflineCache: false,
  };

  // 1. Load config & cache from storage
  await loadStateFromStorage();

  // 2. Fetch fresh metadata from CRM on open
  if (state.token) {
    await fetchCrmMetadata(false);
  } else {
    updateSyncStatus('يرجى إدخال التوكن في الإعدادات', '🟡');
    renderAllDropdowns();
  }

  // 3. Toggle Settings
  toggleSettings.addEventListener('click', () => {
    settingsBox.style.display = settingsBox.style.display === 'none' ? 'block' : 'none';
  });

  // 4. Save API Settings & Trigger Sync
  btnSaveApiSettings.addEventListener('click', async () => {
    state.apiUrl = apiUrlInput.value.trim() || 'https://crmsalon.de/api/v1/extension/capture';
    state.token = apiTokenInput.value.trim();

    saveSettingsToStorage(async () => {
      showAlert('تم حفظ إعدادات الاتصال. جاري مزامنة خدمات وقوائم الصالون...', 'success');
      await fetchCrmMetadata(true);
      settingsBox.style.display = 'none';
    });
  });

  // 5. Manual Sync Button
  btnSyncNow.addEventListener('click', async () => {
    btnSyncNow.disabled = true;
    btnSyncNow.innerText = '⏳ جاري المزامنة...';
    await fetchCrmMetadata(true);
    btnSyncNow.disabled = false;
    btnSyncNow.innerHTML = '<span>تحديث القوائم</span> <span>🔄</span>';
  });

  // 6. Custom Job (Service) Revealing
  jobSelect.addEventListener('change', () => {
    if (jobSelect.value === '__custom__') {
      customJobInput.style.display = 'block';
      customJobNotice.style.display = 'block';
      customJobInput.focus();
    } else {
      customJobInput.style.display = 'none';
      customJobNotice.style.display = 'none';
    }
  });

  // 7. Custom Tag Addition
  if (btnAddCustomTag) {
    btnAddCustomTag.addEventListener('click', () => {
      const rawTag = customTagInput.value.trim();
      if (!rawTag) return;
      if (!state.selectedTags.includes(rawTag)) {
        state.selectedTags.push(rawTag);
        if (!state.tags.some((t) => t.name === rawTag)) {
          state.customTags.push(rawTag);
        }
      }
      customTagInput.value = '';
      renderTags();
    });
  }

  if (customTagInput) {
    customTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnAddCustomTag) btnAddCustomTag.click();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Core: Fetch Metadata from CRM (Single Source of Truth)
  // --------------------------------------------------------------------------
  async function fetchCrmMetadata(isManual = false) {
    if (!state.token) {
      updateSyncStatus('يرجى إدخال التوكن', '🟡');
      return;
    }

    const metaUrl = getMetaEndpointUrl(state.apiUrl);
    updateSyncStatus('جاري الاتصال بنظام الصالون...', '⏳');

    try {
      const headers = {
        Authorization: `Bearer ${state.token.trim()}`,
      };

      if (!isManual && state.version) {
        headers['If-None-Match'] = `W/"meta-${state.version}"`;
      }

      const res = await fetch(metaUrl, {
        method: 'GET',
        headers,
      });

      if (res.status === 304) {
        // Cache is fresh and verified by server
        state.isOfflineCache = false;
        state.lastSyncTime = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        updateSyncStatus(`متطابقة مع الصالون (${state.lastSyncTime})`, '🟢');
        cacheBanner.style.display = 'none';
        renderAllDropdowns();
        saveMetadataCache();
        return;
      }

      if (res.status === 401) {
        updateSyncStatus('التوكن غير مصرح أو منتهي الصلاحية', '🔴');
        showAlert('❌ فشل التحقق: رمز التوكن غير صالح أو ملغي. يرجى مراجعة إعدادات الإضافة.', 'error');
        state.jobs = [];
        state.statuses = [];
        state.employees = [];
        state.tags = [];
        renderAllDropdowns();
        return;
      }

      if (!res.ok) {
        throw new Error(`استجاب الخادم بكود (${res.status})`);
      }

      const json = await res.json();
      if (json.ok && json.data) {
        state.jobs = json.data.jobs || [];
        state.statuses = json.data.statuses || [];
        state.employees = json.data.employees || [];
        state.tags = json.data.tags || [];
        state.currentEmployee = json.data.currentEmployee || null;
        state.version = json.data.version || '';
        state.lastSyncTime = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        state.isOfflineCache = false;

        cacheBanner.style.display = 'none';
        updateSyncStatus(`متزامنة مع الصالون (${state.lastSyncTime})`, '🟢');
        renderAllDropdowns();
        saveMetadataCache();

        if (isManual) {
          showAlert(`✅ تم تحديث القوائم بنجاح من نظام الصالون (${state.jobs.length} خدمة و ${state.tags.length} وسم معتمد).`, 'success');
        }
      }
    } catch (err) {
      console.warn('Metadata fetch failed, falling back to cache:', err.message);

      // Offline / Network Fallback
      if (state.jobs.length > 0) {
        state.isOfflineCache = true;
        updateSyncStatus(`غير متصل (نسخة مخزنة)`, '🟠');
        cacheBanner.style.display = 'block';
        cacheTimeText.textContent = state.lastSyncTime || 'سابقاً';
        renderAllDropdowns();
      } else {
        updateSyncStatus('تعذر الاتصال بالصالون', '🔴');
        showAlert(`⚠️ تعذر جلب الخدمات: ${err.message}. يرجى التحقق من اتصال الإنترنت ورابط الخادم.`, 'warning');
      }
    }
  }

  function getMetaEndpointUrl(captureUrl) {
    if (!captureUrl) return 'https://crmsalon.de/api/v1/extension/meta';
    try {
      const u = new URL(captureUrl);
      if (u.pathname.endsWith('/capture')) {
        u.pathname = u.pathname.replace(/\/capture$/, '/meta');
      } else {
        u.pathname = '/api/v1/extension/meta';
      }
      return u.toString();
    } catch (_e) {
      return captureUrl.replace('/capture', '/meta');
    }
  }

  function updateSyncStatus(text, dot) {
    syncStatusText.textContent = text;
    syncStatusDot.textContent = dot;
  }

  // --------------------------------------------------------------------------
  // Dropdown Renderers (Read-only from CRM)
  // --------------------------------------------------------------------------
  function renderAllDropdowns() {
    renderJobs();
    renderStatuses();
    renderEmployees();
    renderTags();
  }

  function renderJobs() {
    const currentVal = jobSelect.value;
    jobSelect.innerHTML = '<option value="">-- اختر الخدمة المعتمدة --</option>';

    state.jobs.forEach((j) => {
      const opt = document.createElement('option');
      opt.value = j.title;
      opt.textContent = j.department && j.department !== 'عام' ? `${j.title} (${j.department})` : j.title;
      opt.dataset.id = j.id;
      if (j.title === currentVal) opt.selected = true;
      jobSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '✏️ كتابة خدمة أخرى (مقترح للمراجعة)...';
    if (currentVal === '__custom__') customOpt.selected = true;
    jobSelect.appendChild(customOpt);

    jobsCountBadge.textContent = `${state.jobs.length} خدمة`;
  }

  function renderStatuses() {
    const currentVal = statusSelect.value || 'جديد';
    statusSelect.innerHTML = '';

    const list = state.statuses.length > 0 ? state.statuses : [
      { code: 'جديد', label_ar: 'جديدة (طلب أول مرة)', is_default: true },
      { code: 'تم التواصل', label_ar: 'تم التواصل واتساب' },
      { code: 'حجزت موعد', label_ar: 'تم تأكيد حجز الموعد' },
      { code: 'استفسار عن باقة/سعر', label_ar: 'استفسار عن باقة أو عرض' },
      { code: 'عميلة سابقة', label_ar: 'عميلة سابقة / معاودة اتصال' },
      { code: 'عميلة VIP', label_ar: 'عميلة VIP مميزة' },
      { code: 'مؤجل', label_ar: 'مؤجل لاحقاً' },
      { code: 'لم ترد', label_ar: 'لم ترد على المحادثة' },
      { code: 'اعتذرت عن الحجز', label_ar: 'اعتذرت عن الحجز' },
    ];

    list.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = s.label_ar || s.code;
      if (s.code === currentVal || (!currentVal && s.is_default)) opt.selected = true;
      statusSelect.appendChild(opt);
    });
  }

  function renderEmployees() {
    const currentVal = employeeSelect.value;
    const defaultLabel = state.currentEmployee
      ? `(المسؤولة التلقائية: ${state.currentEmployee.displayName})`
      : '(المسؤولة التلقائية: موظفة الاستقبال)';

    employeeSelect.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>`;

    state.employees.forEach((emp) => {
      const opt = document.createElement('option');
      opt.value = emp.displayName;
      opt.textContent = emp.displayName;
      opt.dataset.id = emp.id;
      if (emp.displayName === currentVal) opt.selected = true;
      employeeSelect.appendChild(opt);
    });
  }

  function renderTags() {
    if (!tagsContainer) return;
    tagsContainer.innerHTML = '';

    const allDisplayTags = [...state.tags];
    state.customTags.forEach((ct) => {
      if (!allDisplayTags.some((t) => t.name === ct)) {
        allDisplayTags.push({ id: `custom_${ct}`, name: ct, isCustom: true });
      }
    });

    if (allDisplayTags.length === 0) {
      tagsContainer.innerHTML = '<span style="font-size: 11px; color: #94a3b8;">لا توجد وسوم متاحة من الصالون</span>';
      if (tagsCountBadge) tagsCountBadge.textContent = '0 وسم';
      return;
    }

    allDisplayTags.forEach((t) => {
      const isSelected = state.selectedTags.includes(t.name);
      const chip = document.createElement('span');
      chip.className = `tag-chip ${t.isCustom ? 'custom' : ''} ${isSelected ? 'selected' : ''}`;
      chip.textContent = t.name + (isSelected ? ' ✓' : '');
      chip.title = t.isCustom ? 'وسم مقترح يدوي' : (t.category ? `المجموعة: ${t.category}` : 'وسم معتمد');

      chip.addEventListener('click', () => {
        if (state.selectedTags.includes(t.name)) {
          state.selectedTags = state.selectedTags.filter((st) => st !== t.name);
        } else {
          state.selectedTags.push(t.name);
        }
        renderTags();
      });

      tagsContainer.appendChild(chip);
    });

    if (tagsCountBadge) {
      tagsCountBadge.textContent = `${state.selectedTags.length}/${state.tags.length} وسم`;
    }
    if (customTagsNotice) {
      customTagsNotice.style.display = state.customTags.some((ct) => state.selectedTags.includes(ct)) ? 'block' : 'none';
    }
  }

  // --------------------------------------------------------------------------
  // Storage Persistence
  // --------------------------------------------------------------------------
  async function loadStateFromStorage() {
    if (!chrome?.storage?.local) return;

    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['crmApiUrl', 'crmToken', 'cachedJobs', 'cachedStatuses', 'cachedEmployees', 'cachedTags', 'cachedVersion', 'cachedLastSyncTime'],
        (items) => {
          if (items.crmApiUrl) state.apiUrl = items.crmApiUrl;
          if (items.crmToken) state.token = items.crmToken;
          if (Array.isArray(items.cachedJobs)) state.jobs = items.cachedJobs;
          if (Array.isArray(items.cachedStatuses)) state.statuses = items.cachedStatuses;
          if (Array.isArray(items.cachedEmployees)) state.employees = items.cachedEmployees;
          if (Array.isArray(items.cachedTags)) state.tags = items.cachedTags;
          if (items.cachedVersion) state.version = items.cachedVersion;
          if (items.cachedLastSyncTime) state.lastSyncTime = items.cachedLastSyncTime;

          apiUrlInput.value = state.apiUrl;
          apiTokenInput.value = state.token;

          renderAllDropdowns();
          resolve();
        }
      );
    });
  }

  function saveSettingsToStorage(callback) {
    if (chrome?.storage?.local) {
      chrome.storage.local.set(
        {
          crmApiUrl: state.apiUrl,
          crmToken: state.token,
        },
        callback
      );
    } else if (callback) {
      callback();
    }
  }

  function saveMetadataCache() {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({
        cachedJobs: state.jobs,
        cachedStatuses: state.statuses,
        cachedEmployees: state.employees,
        cachedTags: state.tags,
        cachedVersion: state.version,
        cachedLastSyncTime: state.lastSyncTime,
      });
    }
  }

  // --------------------------------------------------------------------------
  // WhatsApp Active Contact Capture
  // --------------------------------------------------------------------------
  btnCapture.addEventListener('click', async () => {
    hideAlert();
    btnCapture.disabled = true;
    btnCapture.innerText = '⏳ جاري فحص محادثة واتساب...';

    try {
      let [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let targetTab = null;

      if (activeTab?.url?.includes('web.whatsapp.com')) {
        targetTab = activeTab;
      } else {
        const waTabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
        if (waTabs && waTabs.length > 0) {
          targetTab = waTabs[0];
        }
      }

      if (!targetTab) {
        showAlert('يرجى فتح تبويب WhatsApp Web أولاً لتتمكن من سحب جهة الاتصال.', 'warning');
        btnCapture.disabled = false;
        btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
        return;
      }

      // Try sending message to content script
      chrome.tabs.sendMessage(targetTab.id, { action: 'CAPTURE_ACTIVE_CONTACT' }, async (response) => {
        const lastErr = chrome.runtime.lastError;

        if (lastErr || !response) {
          try {
            const injectionResults = await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              func: extractActiveContactInfoFromDOM,
            });

            if (injectionResults && injectionResults[0] && injectionResults[0].result) {
              handleCaptureResult(injectionResults[0].result);
            } else {
              showAlert('تعذر قراءة بيانات المحادثة. يرجى إعادة تحميل صفحة WhatsApp Web والتأكد من فتح محادثة العميل/ة.', 'error');
            }
          } catch (injectErr) {
            showAlert(`تعذر الحقن المباشر في واتساب: ${injectErr.message}`, 'error');
          }
        } else {
          handleCaptureResult(response);
        }

        btnCapture.disabled = false;
        btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
      });
    } catch (e) {
      showAlert(`حدث خطأ أثناء الاتصال بالتبويب: ${e.message}`, 'error');
      btnCapture.disabled = false;
      btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
    }
  });

  function handleCaptureResult(result) {
    if (!result || !result.ok) {
      showAlert(result?.error || 'تعذر استخراج بيانات المحادثة النشطة.', 'warning');
      return;
    }

    if (result.phone) {
      phoneInput.value = cleanAndFormatPhoneNumber(result.phone);
    }
    if (result.name) {
      nameInput.value = result.name;
    }

    showAlert(`✨ تم سحب بيانات العميل/ة بنجاح (${result.name || 'بدون اسم'} - ${result.phone || ''})`, 'success');
  }

  // --------------------------------------------------------------------------
  // Form Submission
  // --------------------------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const apiUrl = state.apiUrl || apiUrlInput.value.trim();
    const token = state.token || apiTokenInput.value.trim();

    if (!token) {
      showAlert('يرجى إدخال رمز الدخول (Bearer Token) أولاً في إعدادات الإضافة بالأسفل.', 'warning');
      settingsBox.style.display = 'block';
      apiTokenInput.focus();
      return;
    }

    const rawPhone = phoneInput.value.trim();
    if (!rawPhone) {
      showAlert('يرجى إدخال رقم الهاتف.', 'warning');
      phoneInput.focus();
      return;
    }

    const phone = cleanAndFormatPhoneNumber(rawPhone);

    let jobVal = jobSelect.value;
    let isCustomJob = false;
    if (jobVal === '__custom__') {
      jobVal = customJobInput.value.trim();
      isCustomJob = true;
    }

    const submittedTags = [...state.selectedTags];
    const hasCustomTags = state.customTags.some((ct) => submittedTags.includes(ct));

    const payload = {
      requestId: crypto.randomUUID(),
      phone,
      name: nameInput.value.trim() || undefined,
      job: jobVal || undefined, // الخدمة المطلوبة
      status: statusSelect.value || 'جديد',
      employee: employeeSelect.value || undefined,
      tags: submittedTags.length > 0 ? submittedTags : undefined,
      interviewed: interviewedCheck.checked, // حجز مسبق / تم تقديم خدمة
      followUpDate: followUpDateInput.value || undefined,
      interviewDate: interviewDateInput.value ? new Date(interviewDateInput.value).toISOString() : undefined, // موعد الحجز/الزيارة
      notes: notesInput.value.trim() || undefined,
    };

    btnSubmit.disabled = true;
    btnSubmit.innerText = '⏳ جاري إرسال العميل/ة إلى نظام الصالون...';

    chrome.runtime.sendMessage(
      {
        action: 'SEND_LEAD_TO_CRM',
        payload,
        config: { apiUrl, token },
      },
      (res) => {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '🚀 إرسال العميل/ة إلى نظام الصالون';

        if (!res) {
          showAlert('لم يتم تلقي استجابة من الخدمة الخلفية.', 'error');
          return;
        }

        if (res.status === 201) {
          let successText = `✅ تم تسجيل العميل/ة بنجاح في نظام الصالون! المعرف: ${res.data?.data?.customerId || res.data?.candidateId || ''}`;
          if (isCustomJob) {
            successText += `<br><span style="font-size:10px; color:#b45309;">💡 تم تسجيل الخدمة ("${escapeHtml(jobVal)}") كمقترح غير معتمد لمراجعة إدارة الصالون.</span>`;
          }
          if (hasCustomTags) {
            successText += `<br><span style="font-size:10px; color:#b45309;">🏷️ تم تسجيل الوسوم غير المعتمدة كمقترحات للمراجعة في لوحة الصالون.</span>`;
          }
          showAlert(successText, 'success', true);
          form.reset();
          customJobInput.style.display = 'none';
          customJobNotice.style.display = 'none';
          statusSelect.value = state.statuses[0]?.code || 'جديد';
          state.selectedTags = [];
          state.customTags = [];
          renderTags();
        } else if (res.status === 409) {
          showAlert(`⚠️ تنبيه تعارض: ${res.data?.error || 'العميل/ة مسجل مسبقاً بنفس رقم الهاتف.'}`, 'warning');
        } else if (res.status === 401) {
          showAlert('❌ فشل التحقق: رمز الدخول غير صحيح أو ملغي أو منتهي الصلاحية.', 'error');
        } else if (res.status === 422) {
          showAlert(`❌ خطأ في التحقق من البيانات: ${res.data?.error || 'يرجى مراجعة الحقول.'}`, 'error');
        } else if (res.status === 503) {
          showAlert('❌ خدمة استقبال البيانات معطلة في بيئة الخادم.', 'error');
        } else {
          showAlert(`❌ حدث خطأ (${res.status || 'فشل الاتصال'}): ${res.data?.error || res.error || 'خطأ غير معروف'}`, 'error');
        }
      }
    );
  });

  function showAlert(msg, type, isHtml = false) {
    if (isHtml) {
      alertBox.innerHTML = msg;
    } else {
      alertBox.textContent = msg;
    }
    alertBox.className = `alert alert-${type}`;
    alertBox.style.display = 'block';
  }

  function hideAlert() {
    alertBox.style.display = 'none';
  }

  function cleanAndFormatPhoneNumber(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let str = rawPhone.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
    const hasPlus = str.startsWith('+') || str.startsWith('00');
    const digits = str.replace(/\D/g, '');

    if (hasPlus) return '+' + digits;
    if (digits.startsWith('966') && digits.length >= 12) return '+' + digits;
    if (digits.startsWith('20') && digits.length >= 11) return '+' + digits;
    return digits;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});

// وظيفة الاستخراج المستقلة للحقن المباشر في واتساب ويب
async function extractActiveContactInfoFromDOM() {
  function isValidRealPhoneNumber(str) {
    if (!str || typeof str !== 'string') return false;
    if (str.includes('@lid') || str.includes('lid')) return false;

    const digits = str.replace(/\D/g, '');
    // استبعاد معرفات LID الداخلية لواتساب
    if (digits.length >= 14 && /^1[345]/.test(digits)) return false;
    if (digits.length < 8 || digits.length > 14) return false;

    // الأرقام المصرية والسعودية والخليجية
    if (/^01[0125]\d{8}$/.test(digits)) return true;
    if (/^05\d{8}$/.test(digits)) return true;
    if (/^(20|966|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)\d{7,12}$/.test(digits)) return true;

    return digits.length >= 8 && digits.length <= 13;
  }

  function cleanAndFormatPhoneNumber(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let str = rawPhone.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
    const hasPlus = str.startsWith('+') || str.startsWith('00');
    const digits = str.replace(/\D/g, '');

    if (hasPlus) return '+' + digits;
    if (digits.startsWith('966') && digits.length >= 12) return '+' + digits;
    if (digits.startsWith('20') && digits.length >= 11) return '+' + digits;
    return digits;
  }

  try {
    const mainContainer = document.querySelector('#main') ||
      document.querySelector('div[data-testid="conversation-panel-body"]') ||
      document.querySelector('div[role="region"]');

    if (!mainContainer) {
      return {
        ok: false,
        error: 'لم يتم العثور على محادثة مفتوحة حالياً. يرجى النقر على محادثة العميل/ة في واتساب ويب لفتحها أولاً.'
      };
    }

    const header = mainContainer.querySelector('header');
    if (!header) {
      return {
        ok: false,
        error: 'تعذر العثور على رأس المحادثة. يرجى فتح محادثة العميل/ة بوضوح.'
      };
    }

    let rawTitle = '';
    let phoneFound = '';
    let nameFound = '';

    const textNodes = [];
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue.trim();
      if (val && !['online', 'typing...', 'متصل الآن', 'يكتب...', 'جاري الكتابة...'].includes(val.toLowerCase())) {
        textNodes.push(val);
      }
    }

    for (const text of textNodes) {
      if (isValidRealPhoneNumber(text)) {
        phoneFound = text;
        break;
      }
    }

    for (const text of textNodes) {
      if (text !== phoneFound && text.length >= 2 && text.length <= 50) {
        nameFound = text;
        break;
      }
    }

    return {
      ok: true,
      name: nameFound || '',
      phone: phoneFound || '',
    };
  } catch (err) {
    return {
      ok: false,
      error: `حدث خطأ أثناء استخراج البيانات: ${err.message}`
    };
  }
}
