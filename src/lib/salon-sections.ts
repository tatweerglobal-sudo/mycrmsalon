export const salonSections = [
  { slug: 'customers', label: 'العملاء', icon: '👥', description: 'ملفات عملاء مراكز التجميل، تفضيلاتهم وسجل زياراتهم' },
  { slug: 'appointments', label: 'الحجوزات', icon: '📅', description: 'إدارة الحجوزات ومواعيد خبراء التجميل ومنع التعارضات' },
  { slug: 'services', label: 'الخدمات', icon: '✨', description: 'الخدمات غير الطبية ومددها وأسعارها والباقات' },
  { slug: 'staff', label: 'فريق العمل', icon: '💇', description: 'الموظفون، الجداول، الصلاحيات والعمولات' },
  { slug: 'reports', label: 'التقارير', icon: '📊', description: 'تقارير الإيرادات والحجوزات وأداء المركز' },
  { slug: 'settings', label: 'الإعدادات', icon: '⚙️', description: 'إعدادات مركز التجميل والاشتراكات والصلاحيات' },
] as const;

export function getSalonSection(slug: string) {
  return salonSections.find(section => section.slug === slug);
}
