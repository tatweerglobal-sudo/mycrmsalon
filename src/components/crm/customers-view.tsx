'use client';

import { useState, useEffect } from 'react';

interface Customer {
  id: string;
  full_name: string;
  phone_raw: string;
  phone_normalized: string;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  loyalty_points: number;
  total_visits: number;
  total_spent: string | number;
  last_visit_at: string | null;
  created_at: string;
}

export default function CustomersView() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [preferences, setPreferences] = useState('');

  const loadCustomers = async (query = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (res.ok) {
        setCustomers(data.customers || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadCustomers(search);
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          phone,
          email: email || undefined,
          notes: notes || undefined,
          preferences: preferences || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حفظ بيانات العميلة');
      } else {
        setSuccess('تمت إضافة العميلة بنجاح');
        setFullName('');
        setPhone('');
        setEmail('');
        setNotes('');
        setPreferences('');
        setTimeout(() => {
          setModalOpen(false);
          setSuccess(null);
        }, 1200);
        loadCustomers();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Search and Add Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearch} className="flex flex-1 max-w-md gap-2">
          <input
            type="text"
            placeholder="البحث بالاسم أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
          >
            بحث
          </button>
        </form>

        <button
          onClick={() => { setError(null); setSuccess(null); setModalOpen(true); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ إضافة عميلة جديدة</span>
        </button>
      </div>

      {/* Main Content / Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل سجل العملاء...</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">👥</div>
          <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد عميلات مسجلات حتى الآن</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
            ابدئي بإضافة أول عميلة لمركزك لتتمكني من استقبال الحجوزات وإصدار الفواتير وبناء سجل الزيارات ونقاط الولاء.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            + إضافة أول عميلة للمركز
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                <tr>
                  <th scope="col" className="px-5 py-3.5">الاسم</th>
                  <th scope="col" className="px-5 py-3.5">رقم الهاتف</th>
                  <th scope="col" className="px-5 py-3.5">الزيارات</th>
                  <th scope="col" className="px-5 py-3.5">إجمالي الإنفاق</th>
                  <th scope="col" className="px-5 py-3.5">نقاط الولاء</th>
                  <th scope="col" className="px-5 py-3.5">تاريخ التسجيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-4 font-bold text-slate-900">
                      <div>{c.full_name}</div>
                      {c.notes && <div className="text-[11px] font-normal text-slate-400">{c.notes}</div>}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700" dir="ltr">
                      {c.phone_normalized}
                    </td>
                    <td className="px-5 py-4 font-bold text-rose-800">
                      {c.total_visits} زيارة
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-900">
                      {Number(c.total_spent).toLocaleString('ar-SA')} ر.س
                    </td>
                    <td className="px-5 py-4 text-xs font-bold text-amber-600">
                      ⭐ {c.loyalty_points}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400">
                      {new Date(c.created_at).toLocaleDateString('ar-SA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal إضافة عميلة */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">إضافة عميلة جديدة</h3>
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

            <form onSubmit={handleCreateCustomer} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">اسم العميلة *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: منيرة العتيبي"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">رقم الهاتف (سعودي) *</label>
                <input
                  type="tel"
                  required
                  placeholder="05XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none text-right font-mono"
                />
                <p className="mt-1 text-[11px] text-slate-400">سيتم حفظ الرقم بصيغة E.164 الدولية (+966)</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">البريد الإلكتروني (اختياري)</label>
                <input
                  type="email"
                  placeholder="client@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">تفضيلات الخدمة والملاحظات (اختياري)</label>
                <textarea
                  rows={2}
                  placeholder="تفضيلات الصبغة، حساسية معينة، أو ملاحظات خاصة..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ بيانات العميلة'}
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
