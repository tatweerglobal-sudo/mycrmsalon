// popup.js - Controller for My CRM Salon Synchronized Extension v1.0.1
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
    updateSyncStatus('يرجى حفظ التوكن أولاً', '🟡');
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
      showAlert('تم حفظ إعدادات الاتصال. جاري مزامنة القوائم من النظام...', 'success');
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

  // 6. Custom Job Revealing
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
    updateSyncStatus('جاري الاتصال بالنظام...', '⏳');

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
        state.isOfflineCache = false;
        state.lastSyncTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        updateSyncStatus(`متطابقة مع النظام (${state.lastSyncTime})`, '🟢');
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
        state.lastSyncTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        state.isOfflineCache = false;

        cacheBanner.style.display = 'none';
        updateSyncStatus(`متزامنة مع النظام (${state.lastSyncTime})`, '🟢');
        renderAllDropdowns();
        saveMetadataCache();

        if (isManual) {
          showAlert(`✅ تم تحديث القوائم بنجاح من النظام (${state.jobs.length} خدمة و ${state.tags.length} وسم معتمد).`, 'success');
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
        updateSyncStatus('تعذر الاتصال بالنظام', '🔴');
        showAlert(`⚠️ تعذر جلب القوائم: ${err.message}. يرجى التحقق من اتصال الإنترنت ورابط الخادم.`, 'warning');
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
    jobSelect.innerHTML = '<option value="">-- اختر الخدمة المطلوبة --</option>';

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
      { code: 'جديد', label_ar: 'جديدة', is_default: true },
      { code: 'تم التواصل', label_ar: 'تم التواصل' },
      { code: 'حجزت موعد', label_ar: 'حجزت موعد' },
      { code: 'استفسار عن باقة/سعر', label_ar: 'استفسار عن باقة/سعر' },
      { code: 'عميلة سابقة', label_ar: 'عميلة سابقة' },
      { code: 'عميلة VIP', label_ar: 'عميلة VIP' },
      { code: 'مؤجل', label_ar: 'مؤجل' },
      { code: 'لم ترد', label_ar: 'لم ترد' },
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
      ? `(المسؤولة: ${state.currentEmployee.displayName})`
      : '(المسؤولة: أخصائية المركز)';

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
      tagsContainer.innerHTML = '<span style="font-size: 11px; color: #94a3b8;">لا توجد وسوم متاحة من النظام</span>';
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

      chrome.tabs.sendMessage(targetTab.id, { action: 'CAPTURE_ACTIVE_CONTACT' }, async (response) => {
        if (!chrome.runtime.lastError && response?.ok && response.data?.phone) {
          handleCaptureResponse(response);
          btnCapture.disabled = false;
          btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
          return;
        }

        try {
          if (chrome.scripting?.executeScript) {
            let execResults = null;
            try {
              execResults = await chrome.scripting.executeScript({
                target: { tabId: targetTab.id },
                world: 'MAIN',
                func: extractActiveContactInfoFromDOM,
              });
            } catch (_worldErr) {
              execResults = await chrome.scripting.executeScript({
                target: { tabId: targetTab.id },
                func: extractActiveContactInfoFromDOM,
              });
            }

            if (execResults && execResults[0]?.result?.ok) {
              handleCaptureResponse(execResults[0].result);
            } else {
              const err = execResults?.[0]?.result?.error || 'لم يتم العثور على محادثة مفتوحة في واتساب ويب.';
              showAlert(`⚠️ ${err}`, 'warning');
            }
          } else {
            showAlert('يرجى فتح نافذة المحادثة في واتساب ويب وإعادة المحاولة.', 'warning');
          }
        } catch (injectionErr) {
          showAlert(`خطأ في فحص محادثة واتساب: ${injectionErr.message}`, 'error');
        } finally {
          btnCapture.disabled = false;
          btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
        }
      });
    } catch (err) {
      showAlert(`حدث خطأ أثناء المحاولة: ${err.message}`, 'error');
      btnCapture.disabled = false;
      btnCapture.innerText = '📥 سحب الاسم والرقم من محادثة واتساب النشطة';
    }
  });

  function handleCaptureResponse(res) {
    if (res.data) {
      if (res.data.phone) {
        phoneInput.value = cleanAndFormatPhoneNumber(res.data.phone);
        phoneInput.setAttribute('dir', 'ltr');
        phoneInput.classList.add('phone-input');
      }
      if (res.data.name && (!nameInput.value || nameInput.value.trim() === '')) {
        nameInput.value = res.data.name;
      }
    }

    if (res.data?.phone) {
      const formattedPhone = cleanAndFormatPhoneNumber(res.data.phone);
      showAlert(`✅ تم سحب بيانات جهة الاتصال بنجاح! (<span dir="ltr">${escapeHtml(formattedPhone)}</span>)`, 'success', true);
    } else if (res.warning) {
      showAlert(res.warning, 'warning');
      phoneInput.focus();
    } else {
      showAlert('تم التقاط بيانات جهة الاتصال بنجاح.', 'success');
    }
  }

  // --------------------------------------------------------------------------
  // Form Submission to CRM
  // --------------------------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const phone = phoneInput.value.trim();
    if (!phone) {
      showAlert('رقم الهاتف حقل إلزامي.', 'error');
      phoneInput.focus();
      return;
    }

    const apiUrl = apiUrlInput.value.trim() || state.apiUrl;
    const token = apiTokenInput.value.trim() || state.token;
    if (!token) {
      showAlert('يرجى إدخال رمز التحقق (Bearer Token) في الإعدادات قبل الإرسال.', 'warning');
      settingsBox.style.display = 'block';
      return;
    }

    // استخراج قيمة الخدمة
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
      job: jobVal || undefined,
      status: statusSelect.value || 'جديد',
      employee: employeeSelect.value || undefined,
      tags: submittedTags.length > 0 ? submittedTags : undefined,
      interviewed: interviewedCheck.checked,
      followUpDate: followUpDateInput.value || undefined,
      interviewDate: interviewDateInput.value ? new Date(interviewDateInput.value).toISOString() : undefined,
      notes: notesInput.value.trim() || undefined,
    };

    btnSubmit.disabled = true;
    btnSubmit.innerText = '⏳ جاري إرسال البيانات إلى النظام...';

    chrome.runtime.sendMessage(
      {
        action: 'SEND_LEAD_TO_CRM',
        payload,
        config: { apiUrl, token },
      },
      (res) => {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '🚀 تسجيل العميل/ة وتأكيد الموعد';

        if (!res) {
          showAlert('لم يتم تلقي استجابة من الخدمة الخلفية.', 'error');
          return;
        }

        if (res.status === 201 || res.status === 200) {
          let successText = `✅ تم تسجيل العميل/ة والموعد بنجاح! المعرف: ${res.data?.candidateId || res.data?.customerId || ''}`;
          if (isCustomJob) {
            successText += `<br><span style="font-size:10px; color:#b45309;">💡 تم تسجيل الخدمة ("${escapeHtml(jobVal)}") كمقترح للمراجعة في النظام.</span>`;
          }
          if (hasCustomTags) {
            successText += `<br><span style="font-size:10px; color:#b45309;">🏷️ تم تسجيل الوسوم غير المعتمدة كمقترحات للمراجعة في النظام.</span>`;
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
          showAlert(`⚠️ تنبيه تعارض: ${res.data?.error || 'العميل/ة مسجل/ة مسبقاً بنفس رقم الهاتف.'}`, 'warning');
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
    // استبعاد معرفات LID الداخلية لواتساب (14 إلى 16 رقماً تبدأ بـ 13 أو 14 أو 15)
    if (digits.length >= 14 && /^1[345]/.test(digits)) return false;
    if (digits.length < 8 || digits.length > 14) return false;

    // الأرقام المصرية المحلية (010, 011, 012, 015)
    if (/^01[0125]\d{8}$/.test(digits)) return true;

    // مفاتيح الدول العربية والدولية المعتمدة
    if (/^(20|966|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|1)\d{7,12}$/.test(digits)) return true;

    return digits.length >= 8 && digits.length <= 13;
  }

  function cleanAndFormatPhoneNumber(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let str = rawPhone.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
    const hasPlus = str.startsWith('+') || str.startsWith('00');
    const digits = str.replace(/\D/g, '');

    if (hasPlus) {
      return '+' + digits;
    }
    if (digits.startsWith('20') && digits.length >= 11) {
      return '+' + digits;
    }
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

    const mainHeader = mainContainer.querySelector('header') ||
      document.querySelector('[data-testid="conversation-info-header"]') ||
      document.querySelector('#main header');

    if (!mainHeader) {
      return {
        ok: false,
        error: 'تعذر تحديد ترويسة المحادثة في واتساب ويب.'
      };
    }

    const titleCandidates = [
      mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]'),
      mainHeader.querySelector('div[role="button"] span[title]'),
      mainHeader.querySelector('span[title]'),
      mainHeader.querySelector('div[role="button"] span[dir="auto"]'),
      mainHeader.querySelector('span[dir="auto"]')
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

    let name = '';
    let phone = '';

    if (isValidRealPhoneNumber(headerTitle)) {
      phone = headerTitle.trim();
      name = '';
    } else {
      name = headerTitle.trim();

      // 1. فحص بنية React Fiber لشجرة المكونات واستخراج pnId أو phoneNumber وتجنب LID
      try {
        const inspectObj = (o, depth = 0, visited = new Set()) => {
          if (!o || depth > 5 || typeof o !== 'object' || visited.has(o)) return null;
          visited.add(o);

          if (typeof o.phoneNumber === 'string' && isValidRealPhoneNumber(o.phoneNumber)) {
            return o.phoneNumber.trim();
          }

          if (o.pnId && typeof o.pnId === 'object') {
            if (o.pnId.server === 'c.us' && o.pnId.user && isValidRealPhoneNumber(o.pnId.user)) {
              return '+' + o.pnId.user;
            }
            if (typeof o.pnId._serialized === 'string' && o.pnId._serialized.endsWith('@c.us')) {
              const m = o.pnId._serialized.match(/^(\d{8,14})@c\.us$/);
              if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
            }
          }

          if (o.id && typeof o.id === 'object' && o.id.server !== 'lid') {
            if ((o.id.server === 'c.us' || o.id.server === 's.whatsapp.net') && o.id.user) {
              if (isValidRealPhoneNumber(o.id.user)) return '+' + o.id.user;
            }
            if (typeof o.id._serialized === 'string' && o.id._serialized.endsWith('@c.us')) {
              const m = o.id._serialized.match(/^(\d{8,14})@c\.us$/);
              if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
            }
          }

          if (typeof o._serialized === 'string' && (o._serialized.endsWith('@c.us') || o._serialized.endsWith('@s.whatsapp.net'))) {
            const m = o._serialized.match(/^(\d{8,14})@(c\.us|s\.whatsapp\.net)$/);
            if (m && isValidRealPhoneNumber(m[1])) return '+' + m[1];
          }

          for (const k of ['contact', 'chat', 'pnId', 'user', 'sender', 'author']) {
            if (o[k]) {
              const r = inspectObj(o[k], depth + 1, visited);
              if (r) return r;
            }
          }
          return null;
        };

        const scanFiber = (domNode) => {
          if (!domNode) return null;
          const keys = Object.keys(domNode);
          const fKey = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          const pKey = keys.find(k => k.startsWith('__reactProps$'));

          if (pKey && domNode[pKey]) {
            const r = inspectObj(domNode[pKey]);
            if (r) return r;
          }
          if (fKey && domNode[fKey]) {
            let f = domNode[fKey];
            let d = 0;
            while (f && d < 40) {
              if (f.memoizedProps) {
                const r = inspectObj(f.memoizedProps);
                if (r) return r;
              }
              f = f.return;
              d++;
            }
          }
          return null;
        };

        phone = scanFiber(mainContainer) || scanFiber(mainHeader);
      } catch (_e) {}

      // 2. قراءة لوحة معلومات جهة الاتصال (Contact Info Drawer)
      if (!phone || !isValidRealPhoneNumber(phone)) {
        try {
          let drawer = document.querySelector('[data-testid="contact-info-drawer"]') ||
                       document.querySelector('div[role="region"][aria-label*="Contact"]') ||
                       document.querySelector('div[role="region"][aria-label*="جهة"]') ||
                       document.querySelector('div[role="region"][aria-label*="معلومات"]') ||
                       document.querySelector('section');

          let opened = false;
          if (!drawer) {
            // تجنب النقر على صورة الحساب الشخصية (Avatar) واستهداف زر الاسم/العنوان فقط
            const titleClickEl =
              mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]')?.closest('div[role="button"]') ||
              mainHeader.querySelector('span[title]')?.closest('div[role="button"]') ||
              mainHeader.querySelector('span[dir="auto"]')?.closest('div[role="button"]') ||
              Array.from(mainHeader.querySelectorAll('div[role="button"]')).find(el => !el.querySelector('img') && !el.getAttribute('data-testid')?.includes('avatar')) ||
              mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
              mainHeader.querySelector('span[title]');

            if (titleClickEl) {
              titleClickEl.click();
              opened = true;
              await new Promise(r => setTimeout(r, 250));
              drawer = document.querySelector('[data-testid="contact-info-drawer"]') ||
                       document.querySelector('div[role="region"][aria-label*="Contact"]') ||
                       document.querySelector('div[role="region"][aria-label*="جهة"]') ||
                       document.querySelector('div[role="region"][aria-label*="معلومات"]') ||
                       document.querySelector('section');
            }
          }

          if (drawer) {
            const intlRegex = /(?:\+|00)\s*(?:20|966|971|965|974|968|973|962|961|963|964|218|216|213|212|249|967|\d{1,3})\s*[\d\s\-()]{7,13}\d/;
            const egRegex = /\b01[0125][\d\s\-]{8}\b/;
            const textEls = drawer.querySelectorAll('span, div');
            for (const el of textEls) {
              const txt = (el.getAttribute('title') || el.textContent || '').trim();
              const m = txt.match(intlRegex) || txt.match(egRegex);
              if (m && isValidRealPhoneNumber(m[0])) {
                phone = m[0].trim();
                break;
              }
            }

            if (opened) {
              // إغلاق الدرج فوراً لتبقى المحادثة مفتوحة
              const closeBtn = drawer.querySelector('button[aria-label*="Close"], button[aria-label*="إغلاق"], span[data-testid="x"]')?.closest('button') ||
                               drawer.querySelector('button');
              if (closeBtn) closeBtn.click();
            }

            // إغلاق أي نافذة صور أو عارض وسائط فوراً
            const mediaCloseBtn = document.querySelector('[data-testid="media-viewer"] button, button[aria-label*="Close photo"], button[aria-label*="إغلاق الصورة"]');
            if (mediaCloseBtn) mediaCloseBtn.click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          }
        } catch (_e) {}
      }

      // 3. البحث في صور الأفاتار (@c.us فقط)
      if (!phone || !isValidRealPhoneNumber(phone)) {
        const images = mainHeader.querySelectorAll('img');
        for (const img of images) {
          const src = img.getAttribute('src') || '';
          const match = src.match(/[?&]u=(\d{8,14})(?:%40|@)c\.us/) ||
                        src.match(/\b(\d{8,14})%40c\.us/) ||
                        src.match(/\b(\d{8,14})@c\.us/);
          if (match && isValidRealPhoneNumber(match[1])) {
            phone = '+' + match[1];
            break;
          }
        }
      }

      // 4. البحث في سمات عناصر المحادثة (@c.us وتجاهل @lid)
      if (!phone || !isValidRealPhoneNumber(phone)) {
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
          if (phone && isValidRealPhoneNumber(phone)) break;
        }
      }

      // 5. فحص المحادثة النشطة في القائمة الجانبية (#pane-side)
      if (!phone || !isValidRealPhoneNumber(phone)) {
        const paneSide = document.querySelector('#pane-side');
        if (paneSide) {
          const sideImgs = paneSide.querySelectorAll('img');
          for (const img of sideImgs) {
            const src = img.getAttribute('src') || '';
            const match = src.match(/[?&]u=(\d{8,14})(?:%40|@)c\.us/) ||
                          src.match(/\b(\d{8,14})%40c\.us/);
            if (match && isValidRealPhoneNumber(match[1])) {
              const parentRow = img.closest('div[role="listitem"], div[role="row"], div[tabindex]');
              if (parentRow && (parentRow.textContent.includes(name) || parentRow.getAttribute('aria-selected') === 'true')) {
                phone = '+' + match[1];
                break;
              }
            }
          }
        }
      }
    }

    if (phone && isValidRealPhoneNumber(phone)) {
      phone = cleanAndFormatPhoneNumber(phone);
    } else {
      phone = ''; // منع أي معرف LID غير صالح
    }

    if (!name && !phone) {
      return {
        ok: false,
        error: 'تعذر قراءة بيانات جهة الاتصال. يرجى التأكد من اختيار المحادثة.'
      };
    }

    let warning;
    if (name && !phone) {
      warning = `تم سحب الاسم ("${name}"). لم يتم العثور على رقم هاتف حقيقي في الترويسة بسبب إعدادات الخصوصية؛ يرجى كتابة رقم الهاتف يدوياً في الخانة.`;
    }

    return {
      ok: true,
      data: {
        name,
        phone,
      },
      warning
    };
  } catch (err) {
    return { ok: false, error: `فشل قراءة بيانات جهة الاتصال: ${err.message}` };
  }
}
