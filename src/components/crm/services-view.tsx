'use client';

import { useState, useEffect } from 'react';

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: string | number;
  is_package: boolean;
  category_name: string | null;
}

interface Category {
  id: string;
  name: string;
}

export default function ServicesView() {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [price, setPrice] = useState(150);
  const [description, setDescription] = useState('');
  const [isPackage, setIsPackage] = useState(false);

  const loadServices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/services');
      const data = await res.json();
      if (res.ok) {
        setServices(data.services || []);
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          categoryId: categoryId || undefined,
          durationMinutes: Number(durationMinutes),
          price: Number(price),
          description: description || undefined,
          isPackage,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حفظ الخدمة');
      } else {
        setSuccess('تمت إضافة الخدمة بنجاح');
        setTimeout(() => {
          setModalOpen(false);
          setSuccess(null);
          setName('');
          setDescription('');
        }, 1200);
        loadServices();
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
          <h2 className="text-lg font-black text-slate-900">قائمة الخدمات غير الطبية والباقات</h2>
          <p className="text-xs text-slate-500">إدارة الخدمات والأسعار ومدد الجلسات</p>
        </div>

        <button
          onClick={() => { setError(null); setSuccess(null); setModalOpen(true); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ إضافة خدمة جديدة</span>
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل قائمة الخدمات...</p>
        </div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">✨</div>
          <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد خدمات مسجلة في المركز</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
            أضيفي أول خدمة أو باقة مع تحديد السعر والمدة لتفعيل الحجوزات.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            + إضافة خدمة الآن
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((srv) => (
            <div key={srv.id} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-slate-900">{srv.name}</h3>
                  <span className="shrink-0 font-black text-rose-800">
                    {Number(srv.price).toLocaleString('ar-SA')} ر.س
                  </span>
                </div>
                {srv.category_name && (
                  <span className="mt-1 inline-block rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                    {srv.category_name}
                  </span>
                )}
                <p className="mt-2 text-xs leading-6 text-slate-600">
                  {srv.description || 'جلسة عناية وتجميل متكاملة بأعلى معايير الجودة.'}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>المدة التقديرية:</span>
                <span className="font-bold text-slate-700">{srv.duration_minutes} دقيقة</span>
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
              <h3 className="text-lg font-black text-slate-900">إضافة خدمة جديدة</h3>
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

            <form onSubmit={handleCreateService} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">اسم الخدمة *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: استشوار وسيراميك ملكي"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">التصنيف (اختياري)</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">-- عام --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">المدة (بالدقائق) *</label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">السعر (ر.س) *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">وصف الخدمة (اختياري)</label>
                <textarea
                  rows={2}
                  placeholder="وصف تفصيلي للمواد المستخدمة أو تفاصيل الجلسة..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPackage"
                  checked={isPackage}
                  onChange={(e) => setIsPackage(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <label htmlFor="isPackage" className="text-xs font-bold text-slate-700">
                  هذه الخدمة عبارة عن باقة تشتمل على عدة جلسات
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الخدمة'}
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
