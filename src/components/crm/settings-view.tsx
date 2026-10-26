'use client';

import { useState, useEffect } from 'react';

interface Branch {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  is_main: boolean;
  opening_time: string;
  closing_time: string;
}

export default function SettingsView() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [salonInfo, setSalonInfo] = useState<{ name: string; slug: string } | null>(null);

  // New Branch Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('الرياض');
  const [address, setAddress] = useState('');
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('22:00');

  const loadBranches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/branches');
      const data = await res.json();
      if (res.ok) {
        setBranches(data.branches || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.activeTenant) {
          setSalonInfo({ name: data.activeTenant.name, slug: data.activeTenant.slug });
        }
      })
      .catch((err) => console.error(err));
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: phone || undefined,
          city,
          address: address || undefined,
          openingTime: `${openingTime}:00`,
          closingTime: `${closingTime}:00`,
          isMain: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حفظ بيانات الفرع');
      } else {
        setSuccess('تمت إضافة الفرع بنجاح');
        setTimeout(() => {
          setModalOpen(false);
          setSuccess(null);
          setName('');
          setAddress('');
        }, 1200);
        loadBranches();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-black text-slate-900">إعدادات المركز والفروع</h2>
        <p className="text-xs text-slate-500">تهيئة بيانات المركز، أوقات العمل، والبنية السحابية لقاعدة البيانات</p>
      </div>

      {/* Salon Information Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="text-sm font-black text-slate-900 mb-4">بيانات المنشأة والاشتراك الإنتاجي</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div>
            <span className="text-slate-400 block mb-1">اسم المركز:</span>
            <span className="font-bold text-slate-800 text-sm">
              {salonInfo?.name ? `${salonInfo.name} (${salonInfo.slug})` : 'جاري التحميل...'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">النطاق الرسمي:</span>
            <span className="font-mono font-bold text-rose-800 text-sm">https://crmsalon.de</span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">خطة النظام:</span>
            <span className="font-bold text-emerald-800">مؤسسي متعدد الفروع (Enterprise SaaS)</span>
          </div>
        </div>
      </div>

      {/* Branches Management */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-slate-900">فروع المركز المعتمدة</h3>
          <button
            onClick={() => { setError(null); setSuccess(null); setModalOpen(true); }}
            className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
          >
            + إضافة فرع جديد
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">جاري تحميل الفروع...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {branches.map((b) => (
              <div key={b.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-slate-900">{b.name}</h4>
                  {b.is_main && (
                    <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-800">
                      الفرع الرئيسي
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p><span className="text-slate-400">المدينة: </span>{b.city || 'الرياض'}</p>
                  <p><span className="text-slate-400">ساعات العمل: </span>{b.opening_time} - {b.closing_time}</p>
                  {b.address && <p><span className="text-slate-400">العنوان: </span>{b.address}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cloud & Database Security Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="text-sm font-black text-slate-900 mb-2">أمان السيرفر وقاعدة البيانات</h3>
        <p className="text-xs text-slate-500 mb-4">
          نظام الإنتاج متصل بقاعدة بيانات Neon PostgreSQL السحابية المخصصة في Frankfurt (eu-central-1).
        </p>
        <div className="rounded-xl bg-slate-50 p-4 text-xs font-mono space-y-2 text-slate-700">
          <div className="flex justify-between">
            <span>Database Engine:</span>
            <span className="text-slate-900 font-bold">PostgreSQL 16 (Neon Serverless)</span>
          </div>
          <div className="flex justify-between">
            <span>Tenant Isolation:</span>
            <span className="text-emerald-700 font-bold">Row-Level Security (RLS) FORCED</span>
          </div>
          <div className="flex justify-between">
            <span>Runtime Role:</span>
            <span className="text-slate-900 font-bold">salon_app_role (Least-Privilege)</span>
          </div>
          <div className="flex justify-between">
            <span>Session Security:</span>
            <span className="text-slate-900 font-bold">HMAC-SHA256 Token with DB Revocation Check</span>
          </div>
        </div>
      </div>

      {/* Modal إضافة فرع */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">إضافة فرع جديد</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                {success}
              </div>
            )}

            <form onSubmit={handleCreateBranch} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">اسم الفرع *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: فرع العليا"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">المدينة</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">العنوان التفصيلي (اختياري)</label>
                <input
                  type="text"
                  placeholder="طريق الملك فهد..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">وقت الافتتاح</label>
                  <input
                    type="time"
                    value={openingTime}
                    onChange={(e) => setOpeningTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">وقت الإغلاق</label>
                  <input
                    type="time"
                    value={closingTime}
                    onChange={(e) => setClosingTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الفرع'}
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
