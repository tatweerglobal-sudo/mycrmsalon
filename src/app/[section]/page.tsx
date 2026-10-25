import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSalonSection, salonSections } from '@/lib/salon-sections';
import { requireServerSession } from '@/lib/auth/server-session';

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

export default function SectionPage({ params }: SectionPageProps) {
  const session = requireServerSession();
  const section = getSalonSection(params.section);
  if (!section) notFound();

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
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-100 hover:text-slate-900"
          >
            <span>←</span>
            <span>لوحة التحكم الرئيسية</span>
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-xs font-black text-rose-800">{section.label}</span>
        </div>

        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">
          معاينة ثابتة (Static Preview)
        </span>
      </div>

      {/* بطاقة تعريف القسم */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-3xl shadow-inner sm:h-20 sm:w-20 sm:text-4xl">
            <span aria-hidden="true">{section.icon}</span>
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">{section.label}</h1>
            <p className="mt-2 text-sm leading-7 text-slate-600 sm:text-base">{section.description}</p>
          </div>
        </div>

        {/* تنبيه حالة المعاينة والـ Backend */}
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs leading-6 text-amber-950 sm:text-sm" role="status">
          <p className="font-bold">⚠️ تنبيه هندسي حول نسخة المعاينة:</p>
          <p className="mt-1">
            هذه النسخة معدة كـ Static HTML/CSS/JS للعرض التجريبي على الاستضافة الثابتة دون Node.js في السيرفر.
            جميع البيانات المعروضة هنا هي نماذج واجهة تجريبية (Mock UI)، ولم يتم تفعيل عمليات الحفظ أو التعديل أو الاتصال بقاعدة بيانات Neon في هذه المعاينة.
          </p>
        </div>
      </div>

      {/* معاينات مخصصة حسب القسم */}
      {section.slug === 'customers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-slate-900">سجل العملاء التجريبي</h2>
            <div className="text-xs font-bold text-slate-500">3 عملاء تجريبيين</div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">العميل</th>
                    <th scope="col" className="px-5 py-3.5">رقم الهاتف (E.164)</th>
                    <th scope="col" className="px-5 py-3.5">البلد</th>
                    <th scope="col" className="px-5 py-3.5">الزيارات</th>
                    <th scope="col" className="px-5 py-3.5">الخدمة المفضلة</th>
                    <th scope="col" className="px-5 py-3.5">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50/80">
                    <td className="px-5 py-4 font-bold text-slate-900">سارة أحمد</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600" dir="ltr">+966 50 123 4567</td>
                    <td className="px-5 py-4">السعودية 🇸🇦</td>
                    <td className="px-5 py-4 font-bold text-rose-800">12 زيارة</td>
                    <td className="px-5 py-4">جلسة عناية بالشعر وتصفيف</td>
                    <td className="px-5 py-4">
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">معاينة فقط</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50/80">
                    <td className="px-5 py-4 font-bold text-slate-900">نور الهدى إبراهيم</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600" dir="ltr">+20 10 1234 5678</td>
                    <td className="px-5 py-4">مصر 🇪🇬</td>
                    <td className="px-5 py-4 font-bold text-rose-800">5 زيارات</td>
                    <td className="px-5 py-4">عناية بالبشرة غير طبية</td>
                    <td className="px-5 py-4">
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">معاينة فقط</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50/80">
                    <td className="px-5 py-4 font-bold text-slate-900">مريم خالد</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600" dir="ltr">+971 50 987 6543</td>
                    <td className="px-5 py-4">الإمارات 🇦🇪</td>
                    <td className="px-5 py-4 font-bold text-rose-800">8 زيارات</td>
                    <td className="px-5 py-4">مانيكير وباديكير سبا</td>
                    <td className="px-5 py-4">
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">معاينة فقط</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section.slug === 'appointments' && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">جدول مواعيد اليوم (نموذج واجهة)</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { time: '10:00 ص', client: 'سارة أحمد', service: 'جلسة شعر', staff: 'ليلى خبيرة التجميل', status: 'مكتمل' },
              { time: '01:30 م', client: 'منى محمود', service: 'عناية أظافر', staff: 'رانيا المختصة', status: 'قيد التنفيذ' },
              { time: '04:00 م', client: 'فاطمة علي', service: 'باقة العروس الكاملة', staff: 'فريق التجميل', status: 'مؤكد' },
            ].map((apt, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-800">{apt.time}</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">{apt.status}</span>
                </div>
                <h3 className="mt-3 font-black text-slate-900">{apt.client}</h3>
                <p className="mt-1 text-xs text-slate-600">الخدمة: {apt.service}</p>
                <p className="mt-1 text-xs text-slate-500">المختصة: {apt.staff}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {section.slug === 'services' && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">قائمة الخدمات غير الطبية والباقات</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: 'باقة إشراقة الصباح', duration: '60 دقيقة', price: '150 ر.س', desc: 'تنظيف وجه سطحي وترطيب وتدليك خفيف' },
              { title: 'عناية وتصفيف ملكي', duration: '90 دقيقة', price: '280 ر.س', desc: 'غسيل بحمام زيت طبيعي واستشوار ومكواة' },
              { title: 'سبا الأيدي والأقدام', duration: '45 دقيقة', price: '120 ر.س', desc: 'تقشير وطلاء أظافر وعناية بالبشرة' },
              { title: 'مكياج سهرة ناعم', duration: '60 دقيقة', price: '350 ر.س', desc: 'مكياج احترافي بأحدث التقنيات مع تثبيت كامل' },
            ].map((srv, idx) => (
              <div key={idx} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-900">{srv.title}</h3>
                    <span className="font-black text-rose-800">{srv.price}</span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-slate-600">{srv.desc}</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span>المدة التقديرية:</span>
                  <span className="font-bold text-slate-700">{srv.duration}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section.slug === 'staff' && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">فريق خبراء التجميل</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'ليلى العمري', role: 'خبيرة تصفيف وعناية بالشعر', shift: 'صباحي 09:00 - 05:00' },
              { name: 'رانيا الزهراني', role: 'أخصائية أظافر وعناية باليدين', shift: 'مسائي 01:00 - 09:00' },
              { name: 'هدى مصطفى', role: 'خبيرة مكياج وبشرة', shift: 'كامل اليوم (حسب الحجوزات)' },
            ].map((st, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="font-black text-slate-900">{st.name}</h3>
                <p className="mt-1 text-xs text-rose-800 font-bold">{st.role}</p>
                <div className="mt-3 text-xs text-slate-500">
                  <span>فترة الدوام: </span>
                  <span className="font-medium text-slate-700">{st.shift}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section.slug === 'reports' && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">مؤشرات الأداء والتقارير (نموذج محاكاة)</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <span className="text-xs font-bold text-slate-500">حجوزات هذا الشهر</span>
              <p className="mt-2 text-2xl font-black text-slate-900">142 حجز</p>
              <p className="mt-1 text-xs text-emerald-600 font-bold">↑ 18% عن الشهر السابق</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <span className="text-xs font-bold text-slate-500">العملاء الجدد</span>
              <p className="mt-2 text-2xl font-black text-slate-900">38 عميلة</p>
              <p className="mt-1 text-xs text-emerald-600 font-bold">↑ 12% معدل نمو</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <span className="text-xs font-bold text-slate-500">الخدمة الأكثر طلباً</span>
              <p className="mt-2 text-base font-black text-slate-900">باقة إشراقة الصباح</p>
              <p className="mt-1 text-xs text-slate-500">46 حجز خلال 30 يوم</p>
            </div>
          </div>
        </div>
      )}

      {section.slug === 'settings' && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">إعدادات مركز التجميل</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h3 className="font-black text-slate-900">بيانات المركز والفرع</h3>
              <p className="mt-2 text-xs leading-6 text-slate-600">
                اسم المركز، العنوان، أوقات العمل الرسمية، ورقم واتساب للتواصل السريع مع العملاء.
              </p>
              <span className="mt-4 inline-block text-xs font-bold text-slate-400">تعديل الإعدادات سيتوفر مع Backend</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h3 className="font-black text-slate-900">سياسة الحجز والإلغاء</h3>
              <p className="mt-2 text-xs leading-6 text-slate-600">
                فترة السماح بإلغاء المواعيد، والرسائل التذكيرية التلقائية عبر واتساب قبل الموعد.
              </p>
              <span className="mt-4 inline-block text-xs font-bold text-slate-400">تعديل الإعدادات سيتوفر مع Backend</span>
            </div>
          </div>
        </div>
      )}

      {/* شريط التنقل بين بقية الأقسام */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">الانتقال السريع لأقسام أخرى</h3>
        <div className="flex flex-wrap gap-2">
          {salonSections
            .filter((s) => s.slug !== section.slug)
            .map((s) => (
              <Link
                key={s.slug}
                href={'/' + s.slug}
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
