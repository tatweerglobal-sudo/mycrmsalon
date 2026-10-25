'use client';

import { useState, useEffect } from 'react';

interface Appointment {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  total_price: string | number;
  final_price: string | number;
  payment_status: string;
  notes: string | null;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  staff_id: string | null;
  staff_name: string | null;
}

interface CustomerOption {
  id: string;
  full_name: string;
  phone_normalized: string;
}

interface ServiceOption {
  id: string;
  name: string;
  price: string | number;
  duration_minutes: number;
}

interface StaffOption {
  id: string;
  display_name: string;
  title: string | null;
}

export default function AppointmentsView() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  // Options for booking modal
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);

  // Booking Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [notes, setNotes] = useState('');

  const loadAppointments = async (status = '') => {
    setLoading(true);
    try {
      const url = status ? `/api/appointments?status=${status}` : '/api/appointments';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setAppointments(data.appointments || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadFormData = async () => {
    try {
      const [cRes, sRes, stRes] = await Promise.all([
        fetch('/api/customers'),
        fetch('/api/services'),
        fetch('/api/staff')
      ]);
      const cData = await cRes.json();
      const sData = await sRes.json();
      const stData = await stRes.json();

      if (cRes.ok) setCustomers(cData.customers || []);
      if (sRes.ok) setServices(sData.services || []);
      if (stRes.ok) setStaffList(stData.staff || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadAppointments(statusFilter);
  }, [statusFilter]);

  const openBookingModal = () => {
    setError(null);
    setSuccess(null);
    loadFormData();
    // Default to tomorrow 10:00 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    // Format YYYY-MM-DDTHH:mm
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
    setStartsAt(localISOTime);
    setModalOpen(true);
  };

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          serviceId: selectedServiceId,
          staffId: selectedStaffId || undefined,
          startsAt: new Date(startsAt).toISOString(),
          notes: notes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حجز الموعد');
      } else {
        setSuccess('تم تسجيل الموعد بنجاح دون أي تعارض زمني');
        setTimeout(() => {
          setModalOpen(false);
          setSuccess(null);
          setSelectedCustomerId('');
          setSelectedServiceId('');
          setSelectedStaffId('');
          setNotes('');
        }, 1200);
        loadAppointments(statusFilter);
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (appointmentId: string, newStatus: string) => {
    try {
      const res = await fetch('/api/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          status: newStatus,
        }),
      });
      if (res.ok) {
        loadAppointments(statusFilter);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'booked':
        return <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">محجوز</span>;
      case 'confirmed':
        return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">مؤكد</span>;
      case 'in_progress':
        return <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-700">قيد التنفيذ</span>;
      case 'completed':
        return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">مكتمل</span>;
      case 'cancelled':
        return <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">ملغي</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Filters & Booking Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { value: '', label: 'جميع المواعيد' },
            { value: 'booked', label: 'المحجوزة' },
            { value: 'confirmed', label: 'المؤكدة' },
            { value: 'in_progress', label: 'قيد التنفيذ' },
            { value: 'completed', label: 'المكتملة' },
            { value: 'cancelled', label: 'الملغاة' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                statusFilter === tab.value
                  ? 'bg-rose-800 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          onClick={openBookingModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ حجز موعد جديد</span>
        </button>
      </div>

      {/* Main Table / Empty State */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل جدول المواعيد...</p>
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">📅</div>
          <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد حجوزات مسجلة</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
            ابدئي بحجز أول موعد لعميلة في المركز لتنظيم جدول الأخصائيات ومنع التعارض الزمني تلقائياً.
          </p>
          <button
            onClick={openBookingModal}
            className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            + تسجيل موعد جديد الآن
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                <tr>
                  <th scope="col" className="px-5 py-3.5">العميلة</th>
                  <th scope="col" className="px-5 py-3.5">موعد الحجز</th>
                  <th scope="col" className="px-5 py-3.5">الأخصائية</th>
                  <th scope="col" className="px-5 py-3.5">المبلغ</th>
                  <th scope="col" className="px-5 py-3.5">الحالة</th>
                  <th scope="col" className="px-5 py-3.5">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-5 py-4 font-bold text-slate-900">
                      <div>{apt.customer_name}</div>
                      <div className="font-mono text-[11px] text-slate-400" dir="ltr">{apt.customer_phone}</div>
                    </td>
                    <td className="px-5 py-4 text-xs">
                      <div className="font-bold text-slate-800">
                        {new Date(apt.starts_at).toLocaleDateString('ar-SA', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                      </div>
                      <div className="font-mono text-slate-500" dir="ltr">
                        {new Date(apt.starts_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs font-medium text-slate-700">
                      {apt.staff_name || 'غير محددة'}
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-900">
                      {Number(apt.final_price).toLocaleString('ar-SA')} ر.س
                    </td>
                    <td className="px-5 py-4">
                      {getStatusBadge(apt.status)}
                    </td>
                    <td className="px-5 py-4 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        {apt.status === 'booked' && (
                          <button
                            onClick={() => handleStatusChange(apt.id, 'confirmed')}
                            className="rounded-lg bg-emerald-50 px-2 py-1 font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            تأكيد
                          </button>
                        )}
                        {['booked', 'confirmed'].includes(apt.status) && (
                          <button
                            onClick={() => handleStatusChange(apt.id, 'in_progress')}
                            className="rounded-lg bg-purple-50 px-2 py-1 font-bold text-purple-800 hover:bg-purple-100"
                          >
                            بدء
                          </button>
                        )}
                        {['booked', 'confirmed', 'in_progress'].includes(apt.status) && (
                          <button
                            onClick={() => handleStatusChange(apt.id, 'completed')}
                            className="rounded-lg bg-blue-50 px-2 py-1 font-bold text-blue-800 hover:bg-blue-100"
                          >
                            إتمام
                          </button>
                        )}
                        {apt.status !== 'cancelled' && (
                          <button
                            onClick={() => handleStatusChange(apt.id, 'cancelled')}
                            className="rounded-lg bg-rose-50 px-2 py-1 font-bold text-rose-700 hover:bg-rose-100"
                          >
                            إلغاء
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Booking Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">حجز موعد جديد</h3>
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

            <form onSubmit={handleBookAppointment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">العميلة *</label>
                <select
                  required
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">-- اختاري العميلة --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.phone_normalized})
                    </option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-600 font-medium">
                    لا توجد عميلات مسجلات بعد. يرجى إضافة عميلة أولاً من قسم &quot;العملاء&quot;.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">الخدمة المطلوبة *</label>
                <select
                  required
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">-- اختاري الخدمة --</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes} دقيقة - {s.price} ر.س)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">الأخصائية المختارة (اختياري)</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">-- تلقائي (أول أخصائية متاحة) --</option>
                  {staffList.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.display_name} {st.title ? `(${st.title})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">تاريخ ووقت الموعد *</label>
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">ملاحظات خاصة بالحجز (اختياري)</label>
                <textarea
                  rows={2}
                  placeholder="ملاحظات حول طلبات العميلة أو أي تفاصيل خاصة..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || customers.length === 0 || services.length === 0}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري التحقق والتسجيل...' : 'تأكيد الحجز ومنع التعارض'}
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
