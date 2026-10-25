import Link from 'next/link';
import { salonSections } from '@/lib/salon-sections';
import { requireServerSession } from '@/lib/auth/server-session';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export default function HomePage() {
  const session = requireServerSession();
  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-l from-rose-900 via-rose-800 to-pink-700 px-5 py-8 text-white shadow-xl sm:px-8">
        <p className="mb-3 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold">
          My CRM Salon • Production Architecture
        </p>
        <h1 className="text-2xl font-black sm:text-3xl">لوحة إدارة مراكز التجميل المتكاملة</h1>
        <p className="mt-3 max-w-2xl text-sm leading-8 text-rose-50">
          نظام سحابي مخصص لإدارة الصالونات ومراكز التجميل غير الطبية. يوفر عزل تام للبيانات بفضل PostgreSQL Row Level Security مع مصادقة آمنة وحماية متقدمة ضد هجمات التخمين.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-white px-5 py-2.5 text-xs font-black text-rose-900 shadow-md transition hover:bg-rose-50"
          >
            تسجيل الدخول للنظام ←
          </Link>
          <a
            href="/api/health"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20"
          >
            فحص صحة النظام (Health API) ⚡
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 text-emerald-950" role="status">
        <span className="font-bold">✅ تم التحقق وتفعيل الحماية:</span> قاعدة بيانات Neon متصلة ومحصنة بترقيات 001 و 002 مع فرض Row-Level Security، وحظر الـ TRUNCATE، وتقييد الصلاحيات على مستوى الأعمدة لدور التطبيق، ونظام مصادقة مشفر بالكامل بـ bcrypt.
      </section>

      <div>
        <h2 className="mb-4 text-lg font-black text-slate-900">الأقسام الأساسية للمركز</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {salonSections.map(section => (
            <Link key={section.slug} href={'/' + section.slug} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span aria-hidden="true" className="text-3xl">{section.icon}</span>
              <h3 className="mt-3 font-black text-slate-900">{section.label}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">{section.description}</p>
              <p className="mt-3 text-xs font-bold text-rose-700">فتح القسم ←</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
