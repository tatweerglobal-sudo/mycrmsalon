'use client';

import { useState, useEffect } from 'react';

interface DashboardStats {
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

export default function ReportsView() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
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

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <p className="text-sm font-bold text-slate-500">جاري إعداد وتحليل التقارير الحية...</p>
      </div>
    );
  }

  const s = stats || {
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
      <div>
        <h2 className="text-lg font-black text-slate-900">مؤشرات الأداء والتقارير الحية</h2>
        <p className="text-xs text-slate-500">بيانات وتحليلات فورية مستخرجة مباشرة من قاعدة بيانات السيرفر</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <span className="text-xs font-bold text-slate-500">إجمالي الإيرادات المحصلة</span>
          <p className="mt-2 text-2xl font-black text-emerald-700">
            {s.totalRevenue.toLocaleString('ar-SA')} ر.س
          </p>
          <p className="mt-1 text-[11px] text-slate-400">سندات القبض والمدفوعات الفعلية</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <span className="text-xs font-bold text-slate-500">حجوزات اليوم</span>
          <p className="mt-2 text-2xl font-black text-rose-800">
            {s.todayAppointments} موعد
          </p>
          <p className="mt-1 text-[11px] text-slate-400">من إجمالي {s.totalAppointments} حجز مسجل</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <span className="text-xs font-bold text-slate-500">قاعدة العملاء النشطة</span>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {s.totalCustomers} عميلة
          </p>
          <p className="mt-1 text-[11px] text-slate-400">مسجلات وموثقات بالهاتف السعودي</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <span className="text-xs font-bold text-slate-500">الخدمات وفريق العمل</span>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {s.activeServices} خدمات / {s.activeStaff} أخصائيات
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {s.lowStockCount > 0 ? `⚠️ ${s.lowStockCount} منتج منخفض المخزون` : 'المخزون متوازن'}
          </p>
        </div>
      </div>

      {/* Tables of recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Appointments */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-black text-slate-900 mb-3">أحدث الحجوزات</h3>
          {s.recentAppointments.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">لا توجد حجوزات حتى الآن</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {s.recentAppointments.map((apt) => (
                <div key={apt.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{apt.customer_name}</span>
                    <span className="text-slate-400 mr-2">• {apt.staff_name || 'بدون تحديد'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-rose-800">{Number(apt.final_price).toLocaleString('ar-SA')} ر.س</span>
                    <span className="text-slate-400">
                      {new Date(apt.starts_at).toLocaleDateString('ar-SA')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Invoices */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-black text-slate-900 mb-3">أحدث الفواتير الصادرة</h3>
          {s.recentInvoices.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">لا توجد فواتير حتى الآن</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {s.recentInvoices.map((inv) => (
                <div key={inv.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-rose-800">{inv.invoice_number}</span>
                    <span className="text-slate-600 mr-2">• {inv.customer_name}</span>
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
