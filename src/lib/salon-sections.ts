export const salonSections = [
  { slug: 'customers', label: 'العملاء', icon: '👥', description: 'ملفات عملاء مراكز التجميل، أرقام الهواتف وتفضيلات وسجل الزيارات' },
  { slug: 'appointments', label: 'الحجوزات', icon: '📅', description: 'إدارة المواعيد ومنع التعارض الزمني لخبراء التجميل' },
  { slug: 'services', label: 'الخدمات', icon: '✨', description: 'قائمة الخدمات غير الطبية ومددها وأسعارها والباقات' },
  { slug: 'staff', label: 'فريق العمل', icon: '💇', description: 'أخصائيات التجميل، الجداول والعمولات' },
  { slug: 'financials', label: 'المالية والفواتير', icon: '💳', description: 'إصدار الفواتير الضريبية، تسجيل المدفوعات والتحصيل' },
  { slug: 'inventory', label: 'المخزون والمنتجات', icon: '📦', description: 'منتجات العناية، حركة التوريد والأرصدة المتاحة' },
  { slug: 'reports', label: 'التقارير', icon: '📊', description: 'تقارير الإيرادات والحجوزات وأداء المركز' },
  { slug: 'settings', label: 'الإعدادات', icon: '⚙️', description: 'إعدادات مركز التجميل والفرع والسياسات' },
] as const;

export function getSalonSection(slug: string) {
  return salonSections.find(section => section.slug === slug);
}
