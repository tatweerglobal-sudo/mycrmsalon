'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface TenantItem {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  currency: string;
  status: 'active' | 'trial' | 'suspended' | 'cancelled';
  subscription_tier: string;
  subscription_expires_at: string | null;
  max_branches: number;
  max_staff: number;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
  branches_count: string | number;
  staff_count: string | number;
  owner_name: string | null;
  owner_email: string | null;
}

interface PlatformKpis {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
}

export default function PlatformAdminView() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [kpis, setKpis] = useState<PlatformKpis>({
    totalTenants: 0,
    activeTenants: 0,
    trialTenants: 0,
    suspendedTenants: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCard, setSuccessCard] = useState<{
    tenantName: string;
    ownerEmail: string;
    tempPassword?: string;
    phone?: string;
  } | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [countryCode, setCountryCode] = useState('SA');
  const [currency, setCurrency] = useState('SAR');
  const [subscriptionTier, setSubscriptionTier] = useState('starter');
  const [status, setStatus] = useState('active');
  const [maxBranches, setMaxBranches] = useState(1);
  const [maxStaff, setMaxStaff] = useState(5);

  const loadTenants = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tenants');
      if (res.ok) {
        const data = await res.json();
        setTenants(data.tenants || []);
        if (data.kpis) setKpis(data.kpis);
      }
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setOwnerPassword(pass);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slug) {
      // اقتراح معرف إنجليزي بسيط إذا كان متاحاً
      const translit = val
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
      setSlug(translit.slice(0, 30));
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          owner_name: ownerName,
          owner_email: ownerEmail,
          owner_password: ownerPassword,
          owner_phone: ownerPhone,
          country_code: countryCode,
          currency,
          subscription_tier: subscriptionTier,
          status,
          max_branches: maxBranches,
          max_staff: maxStaff,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تسجيل المركز الجديد');
      }

      setSuccessCard({
        tenantName: name,
        ownerEmail: ownerEmail,
        tempPassword: ownerPassword,
        phone: ownerPhone,
      });

      // إعادة تعيين الحقول
      setName('');
      setSlug('');
      setOwnerName('');
      setOwnerEmail('');
      setOwnerPassword('');
      setOwnerPhone('');
      setModalOpen(false);
      loadTenants();
    } catch (err: unknown) {
      setError((err as Error).message || 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (tenantId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const confirmMsg =
      nextStatus === 'suspended'
        ? 'هل أنت متأكد من تجميد اشتراك هذا المركز؟ لن يتمكن منسوبوه من الدخول.'
        : 'هل تريد إعادة تفعيل اشتراك هذا المركز؟';

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          status: nextStatus,
        }),
      });
      if (res.ok) {
        loadTenants();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredTenants = tenants.filter((t) => {
    const matchSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()) ||
      (t.owner_email && t.owner_email.toLowerCase().includes(search.toLowerCase())) ||
      (t.owner_name && t.owner_name.toLowerCase().includes(search.toLowerCase()));

    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'enterprise':
        return <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-black text-purple-900">مؤسسي (Enterprise)</span>;
      case 'growth':
        return <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-900">متقدم (Growth)</span>;
      case 'trial':
        return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">تجريبي (Trial)</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">أساسي (Starter)</span>;
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'active':
        return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">🟢 نشط ومفعّل</span>;
      case 'trial':
        return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">⏳ فترة تجريبية</span>;
      case 'suspended':
        return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">🔴 موقوف مؤقتاً</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{st}</span>;
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* رأس الصفحة مع الزر التفاعلي */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-rose-200 bg-gradient-to-l from-rose-900 via-rose-800 to-rose-950 p-6 text-white shadow-xl sm:p-8">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-rose-200 backdrop-blur">
            <span>👑</span>
            <span>بوابة مالك المنصة • Super Admin Engine</span>
          </div>
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">إدارة مراكز التجميل والمشتركين</h1>
          <p className="mt-2 text-xs text-rose-100 sm:text-sm">
            لوحة الإدارة المركزية لإصدار اشتراكات الصالونات، توليد حسابات الملاك، والتحكم في باقات المنصة.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setError(null);
            generateRandomPassword();
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-rose-900 shadow-lg transition hover:bg-rose-50 hover:scale-105 active:scale-95"
        >
          <span className="text-lg">✨</span>
          <span>تسجيل مركز تجميل جديد</span>
        </button>
      </div>

      {/* بطاقة نجاح التوليد الفوري */}
      {successCard && (
        <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-950 shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎉</span>
              <div>
                <h3 className="text-base font-black text-emerald-900">
                  تم تسجيل &quot;{successCard.tenantName}&quot; وتجهيز الحساب بنجاح!
                </h3>
                <p className="mt-1 text-xs text-emerald-700">
                  بيانات الدخول جاهزة الآن ويمكنك إرسالها للعميلة/الصالون فوراً:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuccessCard(null)}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-900"
            >
              ✕ إغلاق
            </button>
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-emerald-200 bg-white p-4 text-xs sm:grid-cols-3">
            <div>
              <span className="text-slate-500 block">رابط المنصة:</span>
              <span className="font-mono font-bold text-rose-800">https://crmsalon.de</span>
            </div>
            <div>
              <span className="text-slate-500 block">البريد الإلكتروني:</span>
              <span className="font-mono font-bold text-slate-900">{successCard.ownerEmail}</span>
            </div>
            <div>
              <span className="text-slate-500 block">كلمة المرور الابتدائية:</span>
              <span className="font-mono font-bold text-emerald-700">{successCard.tempPassword}</span>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const text = `مرحباً بك في منصة My CRM Salon!\nتم تفعيل اشتراك مركز "${successCard.tenantName}".\n\nرابط الدخول: https://crmsalon.de\nالبريد: ${successCard.ownerEmail}\nكلمة المرور: ${successCard.tempPassword}`;
                navigator.clipboard.writeText(text);
                alert('تم نسخ رسالة الترحيب وبيانات الدخول إلى الحافظة!');
              }}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-800"
            >
              📋 نسخ بيانات الاشتراك للعميل
            </button>
          </div>
        </div>
      )}

      {/* بطاقات المؤشرات العامة (Platform KPIs) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي مراكز التجميل</span>
            <span className="text-xl">🏢</span>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{kpis.totalTenants}</p>
          <p className="mt-1 text-[11px] text-slate-400">صالونات مسجلة على المنصة</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">الاشتراكات النشطة</span>
            <span className="text-xl">🟢</span>
          </div>
          <p className="mt-3 text-3xl font-black text-emerald-700">{kpis.activeTenants}</p>
          <p className="mt-1 text-[11px] text-slate-400">مراكز مفعلة وتستقبل حجوزات</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">فترات تجريبية</span>
            <span className="text-xl">⏳</span>
          </div>
          <p className="mt-3 text-3xl font-black text-amber-700">{kpis.trialTenants}</p>
          <p className="mt-1 text-[11px] text-slate-400">صالونات تحت التجربة المجانية</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">المراكز الموقوفة</span>
            <span className="text-xl">🔴</span>
          </div>
          <p className="mt-3 text-3xl font-black text-rose-700">{kpis.suspendedTenants}</p>
          <p className="mt-1 text-[11px] text-slate-400">اشتراكات معلقة أو متأخرة</p>
        </div>
      </div>

      {/* شريط البحث والتصفية */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-1 items-center gap-2">
          <span className="text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="البحث باسم الصالون، المعرف، اسم المالك أو الإيميل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500">الحالة:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none"
          >
            <option value="all">كافة الحالات</option>
            <option value="active">نشط فقط</option>
            <option value="trial">تجريبي فقط</option>
            <option value="suspended">موقوف فقط</option>
          </select>
        </div>
      </div>

      {/* جدول مراكز التجميل المشتركة */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-black uppercase text-slate-500">
              <tr>
                <th className="px-5 py-4">مركز التجميل</th>
                <th className="px-5 py-4">المالك / الاتصال</th>
                <th className="px-5 py-4">الفروع / الموظفون</th>
                <th className="px-5 py-4">الباقة</th>
                <th className="px-5 py-4">حالة الاشتراك</th>
                <th className="px-5 py-4">تاريخ التسجيل</th>
                <th className="px-5 py-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    جاري تحميل قائمة مراكز التجميل المشتركة...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    لم يتم العثور على أي مراكز تجميل تطابق معايير البحث.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => (
                  <tr key={t.id} className="transition hover:bg-slate-50/50">
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900">{t.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400" dir="ltr">
                        slug: {t.slug}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800">{t.owner_name || 'غير محدد'}</div>
                      <div className="mt-0.5 text-slate-500">{t.owner_email || t.contact_email}</div>
                      {t.contact_phone && (
                        <div className="mt-0.5 font-mono text-[11px] text-slate-400" dir="ltr">
                          {t.contact_phone}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-bold text-slate-900">{t.branches_count}</span> فرع /{' '}
                      <span className="font-bold text-slate-900">{t.staff_count}</span> موظف
                    </td>

                    <td className="px-5 py-4">{getTierBadge(t.subscription_tier)}</td>

                    <td className="px-5 py-4">{getStatusBadge(t.status)}</td>

                    <td className="px-5 py-4 text-slate-500">
                      {new Date(t.created_at).toLocaleDateString('ar-SA')}
                    </td>

                    <td className="px-5 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(t.id, t.status)}
                        className={`rounded-xl px-3 py-1.5 text-[11px] font-bold transition shadow-xs ${
                          t.status === 'active'
                            ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        }`}
                      >
                        {t.status === 'active' ? 'تجميد الاشتراك' : 'تفعيل المركز'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* نافذة تسجيل مركز تجميل جديد (Modal) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">✨ تسجيل مركز تجميل جديد (اشتراك جديد)</h2>
                <p className="mt-1 text-xs text-slate-500">
                  قم بإنشاء صالون تجميل جديد وتوليد حساب المالك والفرع الرئيسي بضغطة زر.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                ⚠️ {error}
              </div>
            )}

            <form onSubmit={handleCreateTenant} className="mt-6 space-y-4">
              {/* بيانات المركز الأساسية */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700">اسم مركز التجميل *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="مثال: صالون ريفان بيوتي"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700">معرف النطاق (Slug بالإنجليزية) *</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="rivan-salon"
                    dir="ltr"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-mono text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* بيانات مالك الصالون */}
              <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 space-y-4">
                <h3 className="text-xs font-black text-rose-900">👤 بيانات مالكة / مدير المركز (حساب الدخول)</h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">اسم المالك/المديرة *</label>
                    <input
                      type="text"
                      required
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="منى العتيبي"
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">رقم الهاتف / الواتساب</label>
                    <input
                      type="tel"
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                      placeholder="05XXXXXXXX"
                      dir="ltr"
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">البريد الإلكتروني للدخول *</label>
                    <input
                      type="email"
                      required
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="owner@rivansalon.com"
                      dir="ltr"
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-700">كلمة المرور *</label>
                      <button
                        type="button"
                        onClick={generateRandomPassword}
                        className="text-[11px] font-bold text-rose-700 hover:underline"
                      >
                        ⚡ توليد عشوائي
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      dir="ltr"
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 shadow-xs focus:border-rose-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* باقة الاشتراك وإعدادات الدولة */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">الدولة والعملة</label>
                  <select
                    value={countryCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setCountryCode(code);
                      setCurrency(code === 'EG' ? 'EGP' : code === 'AE' ? 'AED' : code === 'DE' ? 'EUR' : 'SAR');
                    }}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-rose-600 focus:outline-none"
                  >
                    <option value="SA">🇸🇦 المملكة العربية السعودية (SAR)</option>
                    <option value="EG">🇪🇬 جمهورية مصر العربية (EGP)</option>
                    <option value="AE">🇦🇪 الإمارات العربية المتحدة (AED)</option>
                    <option value="DE">🇩🇪 ألمانيا (EUR)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700">باقة الاشتراك</label>
                  <select
                    value={subscriptionTier}
                    onChange={(e) => setSubscriptionTier(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-rose-600 focus:outline-none"
                  >
                    <option value="starter">أساسي (Starter - 1 فرع / 5 موظفين)</option>
                    <option value="growth">متقدم (Growth - 3 فروع / 15 موظف)</option>
                    <option value="enterprise">مؤسسي (Enterprise - فروع غير محدودة)</option>
                    <option value="trial">تجريبي مجاني (Trial - 14 يوماً)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700">حالة الحساب</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-rose-600 focus:outline-none"
                  >
                    <option value="active">🟢 مفعّل مباشرة</option>
                    <option value="trial">⏳ فترة تجريبية</option>
                    <option value="suspended">🔴 موقوف مؤقتاً</option>
                  </select>
                </div>
              </div>

              {/* أزرار الإجراء */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-rose-800 px-6 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-rose-900 disabled:opacity-60"
                >
                  {saving ? 'جاري تجهيز الصالون...' : 'تأكيد وإنشاء مركز التجميل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
