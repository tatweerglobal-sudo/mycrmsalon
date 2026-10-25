import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSalonSection, salonSections } from '@/lib/salon-sections';
import { requireServerSession } from '@/lib/auth/server-session';

import CustomersView from '@/components/crm/customers-view';
import AppointmentsView from '@/components/crm/appointments-view';
import ServicesView from '@/components/crm/services-view';
import StaffView from '@/components/crm/staff-view';
import FinancialsView from '@/components/crm/financials-view';
import InventoryView from '@/components/crm/inventory-view';
import ReportsView from '@/components/crm/reports-view';
import SettingsView from '@/components/crm/settings-view';

export function generateStaticParams() {
  return salonSections.map((section) => ({
    section: section.slug,
  }));
}

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';
export const dynamicParams = true;

interface SectionPageProps {
  params: {
    section: string;
  };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const session = await requireServerSession();
  const section = getSalonSection(params.section);
  if (!section) notFound();

  const headersList = headers();
  const token = headersList.get('x-session-token');
  const makeHref = (path: string) => (token ? `${path}?st=${encodeURIComponent(token)}` : path);

  // فحص صلاحيات الوصول حسب الدور (Role-based access control)
  const isOwnerOrManager = session.role === 'salon_owner' || session.role === 'salon_manager' || session.isSuperAdmin;
  const isRestrictedAdminSection = ['financials', 'settings', 'staff'].includes(section.slug);

  if (isRestrictedAdminSection && !isOwnerOrManager) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950 sm:p-8" role="alert">
        <h1 className="text-xl font-black text-rose-900">⚠️ صلاحيات غير كافية (403 Forbidden)</h1>
        <p className="mt-2 text-sm leading-7">
          عذراً، هذا القسم مخصص لمالكة المركز أو المديرة الإدارية فقط. دورك الحالي ({session.role}) لا يملك صلاحية عرض هذا القسم.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-800 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-900"
        >
          العودة للوحة التحكم الرئيسية ←
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* رأس الصفحة ومسار التنقل */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={makeHref('/')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-100 hover:text-slate-900"
          >
            <span>←</span>
            <span>لوحة التحكم الرئيسية</span>
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-xs font-black text-rose-800">{section.label}</span>
        </div>

        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-900">
          نظام الإنتاج الفعلي (Live SaaS)
        </span>
      </div>

      {/* المحتوى الفعلي حسب القسم */}
      <div className="min-h-[400px]">
        {section.slug === 'customers' && <CustomersView />}
        {section.slug === 'appointments' && <AppointmentsView />}
        {section.slug === 'services' && <ServicesView />}
        {section.slug === 'staff' && <StaffView />}
        {section.slug === 'financials' && <FinancialsView />}
        {section.slug === 'inventory' && <InventoryView />}
        {section.slug === 'reports' && <ReportsView />}
        {section.slug === 'settings' && <SettingsView />}
      </div>

      {/* شريط التنقل السريع بين بقية الأقسام */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">الانتقال السريع لأقسام أخرى</h3>
        <div className="flex flex-wrap gap-2">
          {salonSections
            .filter((s) => s.slug !== section.slug)
            .map((s) => (
              <Link
                key={s.slug}
                href={makeHref('/' + s.slug)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900"
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
