'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardStats {
  salonName?: string;
  totalCustomers: number;
  todayAppointments: number;
  totalAppointments: number;
  totalRevenue: number;
  activeServices: number;
  activeStaff: number;
  lowStockCount: number;
  recentAppointments: Array<{
    id: string;
    starts_at: string;
    status: string;
    final_price: string | number;
    customer_name: string;
    staff_name: string | null;
  }>;
  recentInvoices: Array<{
    id: string;
    invoice_number: string;
    total_amount: string | number;
    paid_amount: string | number;
    status: string;
    created_at: string;
    customer_name: string;
  }>;
}

export default function DashboardHome() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/dashboard/stats');
      const data = await res.json();
      if (res.ok) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const makeHref = (path: string) => {
    if (typeof window !== 'undefined') {
      try {
        const token = localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
        if (token) return path + (path.includes('?') ? '&' : '?') + 'st=' + encodeURIComponent(token);
      } catch (_e) {}
    }
    return path;
  };

  useEffect(() => {
    loadStats();
  }, []);

  const s = stats || {
    salonName: 'مركز التجميل',
    totalCustomers: 0,
    todayAppointments: 0,
    totalAppointments: 0,
    totalRevenue: 0,
    activeServices: 0,
    activeStaff: 0,
    lowStockCount: 0,
    recentAppointments: [],
    recentInvoices: [],
  };

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <section className="rounded-3xl bg-gradient-to-l from-rose-900 via-rose-800 to-pink-700 px-5 py-8 text-white shadow-xl sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold">
              ✨ {s.salonName || 'مركز التجميل'} • الإنتاج الفعلي
            </p>
            <h1 className="text-2xl font-black sm:text-3xl">لوحة إدارة المركز اليومية</h1>
            <p className="mt-2 max-w-xl text-xs sm:text-sm leading-6 text-rose-100">
              متابعة الحجوزات اليومية، استقبال العميلات، إصدار الفواتير الفورية وإدارة المخزون وفريق العمل بأعلى درجات الأمان.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link
              href={makeHref('/appointments')}
              className="rounded-xl bg-white px-4 py-2.5 text-xs font-black text-rose-900 shadow-md transition hover:bg-rose-50"
            >
              + حجز موعد جديد
            </Link>
            <Link
              href={makeHref('/customers')}
              className="rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20"
            >
              + إضافة عميلة
            </Link>
            <Link
              href={makeHref('/financials')}
              className="rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20"
            >
              + إصدار فاتورة
            </Link>
          </div>
        </div>
      </section>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">مواعيد اليوم</span>
            <span className="text-lg">📅</span>
          </div>
          <p className="mt-3 text-2xl font-black text-slate-900">
            {loading ? '...' : s.todayAppointments} موعد
          </p>
          <p className="mt-1 text-[11px] text-slate-400">مواعيد مجدولة لتاريخ اليوم</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي الإيرادات</span>
            <span className="text-lg">💰</span>
          </div>
          <p className="mt-3 text-2xl font-black text-emerald-700">
            {loading ? '...' : s.totalRevenue.toLocaleString('ar-SA')} ر.س
          </p>
          <p className="mt-1 text-[11px] text-slate-400">التحصيلات النقدية والشبكة</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي العميلات</span>
            <span className="text-lg">👥</span>
          </div>
          <p className="mt-3 text-2xl font-black text-slate-900">
            {loading ? '...' : s.totalCustomers} عميلة
          </p>
          <p className="mt-1 text-[11px] text-slate-400">سجلات العملاء النشطة</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">الخدمات وفريق العمل</span>
            <span className="text-lg">✨</span>
          </div>
          <p className="mt-3 text-2xl font-black text-rose-800">
            {loading ? '...' : `${s.activeServices} خدمات / ${s.activeStaff} خبيرات`}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">جاهزية المركز لاستقبال الطلبات</p>
        </div>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Appointments Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-slate-900">أحدث الحجوزات والمواعيد</h2>
            <Link href="/appointments" className="text-xs font-bold text-rose-700 hover:text-rose-800">
              عرض كل الحجوزات ←
            </Link>
          </div>

          {loading ? (
            <p className="text-xs text-slate-400 py-6 text-center">جاري تحميل المواعيد...</p>
          ) : s.recentAppointments.length === 0 ? (
            <div className="py-8 text-center">
              <span className="text-3xl block mb-2">📅</span>
              <p className="text-xs font-bold text-slate-700">لا توجد حجوزات مسجلة اليوم</p>
              <p className="mt-1 text-[11px] text-slate-400">ابدئي بحجز موعد جديد لإضافته إلى جدول الأعمال.</p>
              <Link
                href="/appointments"
                className="mt-3 inline-block rounded-xl bg-rose-50 px-3.5 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100"
              >
                + حجز موعد الآن
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {s.recentAppointments.map((apt) => (
                <div key={apt.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-slate-900">{apt.customer_name}</p>
                    <p className="text-[11px] text-slate-400">{apt.staff_name || 'أخصائية التجميل'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-900">{Number(apt.final_price).toLocaleString('ar-SA')} ر.س</span>
                    <span className="text-slate-400 font-mono" dir="ltr">
                      {new Date(apt.starts_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Invoices Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-slate-900">الفواتير الأخيرة</h2>
            <Link href={makeHref('/financials')} className="text-xs font-bold text-rose-700 hover:text-rose-800">
              عرض المالية ←
            </Link>
          </div>

          {loading ? (
            <p className="text-xs text-slate-400 py-6 text-center">جاري تحميل الفواتير...</p>
          ) : s.recentInvoices.length === 0 ? (
            <div className="py-8 text-center">
              <span className="text-3xl block mb-2">💳</span>
              <p className="text-xs font-bold text-slate-700">لا توجد فواتير صادرة حتى الآن</p>
              <p className="mt-1 text-[11px] text-slate-400">يمكنك إصدار الفواتير وتحصيل المبالغ فور إنجاز الخدمات.</p>
              <Link
                href={makeHref('/financials')}
                className="mt-3 inline-block rounded-xl bg-rose-50 px-3.5 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100"
              >
                + إصدار فاتورة الآن
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {s.recentInvoices.map((inv) => (
                <div key={inv.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-rose-800">{inv.invoice_number}</span>
                    <p className="text-[11px] text-slate-500">{inv.customer_name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-900">{Number(inv.total_amount).toLocaleString('ar-SA')} ر.س</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      inv.status === 'paid' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                    }`}>
                      {inv.status === 'paid' ? 'مسددة' : 'معلقة'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
