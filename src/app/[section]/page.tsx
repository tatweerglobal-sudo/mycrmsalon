import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSalonSection } from '@/lib/salon-sections';

export default function SectionPage({ params }: { params: { section: string } }) {
  const section = getSalonSection(params.section);
  if (!section) notFound();

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm font-bold text-rose-800">← العودة للوحة التحكم</Link>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-4xl" aria-hidden="true">{section.icon}</div>
        <h1 className="mt-3 text-2xl font-black">{section.label}</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600">{section.description}</p>
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
          هذا القسم مجرد هيكل مبدئي. لم يتم تفعيل الوظائف أو ربط بيانات حقيقية بعد.
        </p>
      </div>
    </div>
  );
}
