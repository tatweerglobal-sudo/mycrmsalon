import Link from 'next/link';
import { salonSections } from '@/lib/salon-sections';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-l from-rose-900 via-rose-800 to-pink-700 px-5 py-8 text-white shadow-xl sm:px-8">
        <p className="mb-3 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold">
          My CRM Salon • Beauty SaaS Foundation
        </p>
        <h1 className="text-2xl font-black sm:text-3xl">لوحة إدارة مراكز التجميل</h1>
        <p className="mt-3 max-w-2xl text-sm leading-8 text-rose-50">
          بداية مستقلة لنظام إدارة مراكز التجميل والصالونات غير الطبية. نعيد استخدام المكونات العامة الآمنة من صمود فقط،
          مع إعادة تصميم وحدات العملاء والحجوزات والخدمات والصلاحيات لهذا النشاط.
        </p>
      </section>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950" role="status">
        هذه واجهة تأسيسية وليست نظاماً جاهزاً للاستخدام أو الإنتاج. لا توجد حالياً بيانات فعلية، ولا اتصال بـ Neon، ولا مصادقة مستخدمين.
      </section>
      <div>
        <h2 className="mb-4 text-lg font-black text-slate-900">الأقسام المخطط تنفيذها</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {salonSections.map(section => (
            <Link key={section.slug} href={'/' + section.slug} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span aria-hidden="true" className="text-3xl">{section.icon}</span>
              <h3 className="mt-3 font-black text-slate-900">{section.label}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">{section.description}</p>
              <p className="mt-3 text-xs font-bold text-rose-700">قيد التطوير ←</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
