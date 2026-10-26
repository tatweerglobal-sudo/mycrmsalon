// src/app/suspended/page.tsx
import Link from 'next/link';

export default function SuspendedPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center" dir="rtl">
      <div className="mx-auto max-w-md rounded-3xl border border-rose-200 bg-white p-8 shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100 text-3xl">
          ⚠️
        </div>
        <h1 className="text-xl font-black text-slate-900 mb-2">اشتراك المركز موقوف أو معلق</h1>
        <p className="text-xs text-slate-600 leading-relaxed mb-6">
          تم تعليق الوصول إلى حساب هذا المركز مؤقتاً من قِبل إدارة منصة My CRM Salon.
          يرجى التواصل مع إدارة المنصة أو الدعم الفني لإعادة تفعيل الاشتراك.
        </p>
        <div className="space-y-3">
          <a
            href="mailto:support@crmsalon.de"
            className="block w-full rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow transition hover:bg-rose-800"
          >
            التواصل مع الدعم الفني (support@crmsalon.de)
          </a>
          <Link
            href="/login"
            className="block w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            تسجيل الدخول بحساب آخر
          </Link>
        </div>
      </div>
    </div>
  );
}
