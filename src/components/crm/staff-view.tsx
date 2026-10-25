'use client';

import { useState, useEffect } from 'react';

interface StaffMember {
  id: string;
  display_name: string;
  title: string | null;
  commission_rate: string | number;
  branch_name: string | null;
  is_active: boolean;
  created_at: string;
}

export default function StaffView() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('أخصائية عناية وتجميل');
  const [commissionRate, setCommissionRate] = useState(10);

  const loadStaff = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      if (res.ok) {
        setStaff(data.staff || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          title,
          commissionRate: Number(commissionRate),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حفظ بيانات الموظفة');
      } else {
        setSuccess('تمت إضافة الموظفة بنجاح');
        setTimeout(() => {
          setModalOpen(false);
          setSuccess(null);
          setDisplayName('');
        }, 1200);
        loadStaff();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">فريق خبيرات وأخصائيات التجميل</h2>
          <p className="text-xs text-slate-500">إدارة المختصات ومتابعة نسب العمولات والحجوزات</p>
        </div>

        <button
          onClick={() => { setError(null); setSuccess(null); setModalOpen(true); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ إضافة أخصائية جديدة</span>
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل فريق العمل...</p>
        </div>
      ) : staff.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">💇</div>
          <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد أخصائيات مسجلات</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
            أضيفي أول أخصائية لفريق عمل المركز لتتمكني من إسناد الحجوزات وتنظيم المواعيد وحساب العمولات.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            + إضافة أخصائية الآن
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((st) => (
            <div key={st.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-black text-slate-900">{st.display_name}</h3>
                  <p className="mt-1 text-xs font-bold text-rose-800">{st.title || 'أخصائية تجميل'}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                  نشطة
                </span>
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>الفرع:</span>
                  <span className="font-medium text-slate-800">{st.branch_name || 'الفرع الرئيسي'}</span>
                </div>
                <div className="flex justify-between">
                  <span>نسبة العمولة:</span>
                  <span className="font-bold text-slate-900">{st.commission_rate}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">إضافة أخصائية جديدة</h3>
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

            <form onSubmit={handleCreateStaff} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">اسم الأخصائية *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: ريم الدوسري"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">المسمى الوظيفي / التخصص *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: خبيرة عناية بالبشرة وتدليك"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">نسبة العمولة (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  required
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">تحسب هذه النسبة من إجمالي الخدمات المنجزة</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ بيانات الأخصائية'}
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
