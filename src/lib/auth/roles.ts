// src/lib/auth/roles.ts
// نظام الصلاحيات والأدوار المعتمد لـ My CRM Salon SaaS

export type SalonRole =
  | 'saas_super_admin'
  | 'salon_owner'
  | 'salon_manager'
  | 'receptionist'
  | 'beauty_specialist'
  | 'accountant';

export type Permission =
  | 'tenant:manage' // إدارة المركز والاشتراك على مستوى المنصة (Super Admin)
  | 'tenant:settings' // تعديل إعدادات مركز التجميل (Owner)
  | 'branches:manage' // إدارة الفروع وأوقات الدوام
  | 'staff:manage' // إدارة الموظفين والعمولات وجداول العمل
  | 'services:manage' // تسعير الخدمات غير الطبية وتحديد المدد
  | 'customers:view' // استعراض ملفات العملاء
  | 'customers:manage' // إضافة وتعديل بيانات وتفضيلات العملاء
  | 'appointments:view_all' // استعراض كافة المواعيد بالفرع/المركز
  | 'appointments:view_own' // استعراض المواعيد الخاصة بالأخصائية فقط
  | 'appointments:manage' // حجز، تغيير، وإلغاء المواعيد
  | 'financials:view' // الاطلاع على المداخيل، الصندوق والتقارير المالية
  | 'invoices:manage' // إصدار الفواتير وتحصيل المدفوعات
  | 'audit:view'; // استعراض سجلات النشاط والأمان

export const ROLE_PERMISSIONS: Record<SalonRole, readonly Permission[]> = {
  saas_super_admin: [
    'tenant:manage',
    'tenant:settings',
    'branches:manage',
    'staff:manage',
    'services:manage',
    'customers:view',
    'customers:manage',
    'appointments:view_all',
    'appointments:manage',
    'financials:view',
    'invoices:manage',
    'audit:view',
  ],
  salon_owner: [
    'tenant:settings',
    'branches:manage',
    'staff:manage',
    'services:manage',
    'customers:view',
    'customers:manage',
    'appointments:view_all',
    'appointments:manage',
    'financials:view',
    'invoices:manage',
    'audit:view',
  ],
  salon_manager: [
    'branches:manage',
    'staff:manage',
    'services:manage',
    'customers:view',
    'customers:manage',
    'appointments:view_all',
    'appointments:manage',
    'financials:view',
    'invoices:manage',
    'audit:view',
  ],
  receptionist: [
    'customers:view',
    'customers:manage',
    'appointments:view_all',
    'appointments:manage',
    'invoices:manage',
  ],
  beauty_specialist: [
    'customers:view',
    'appointments:view_own',
  ],
  accountant: [
    'customers:view',
    'appointments:view_all',
    'financials:view',
    'invoices:manage',
  ],
};

/**
 * التحقق مما إذا كان الدور يملك صلاحية معينة
 */
export function hasPermission(
  role: SalonRole,
  permission: Permission,
  isSuperAdmin = false
): boolean {
  if (isSuperAdmin || role === 'saas_super_admin') {
    return true;
  }
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes(permission);
}

/**
 * التحقق من صلاحية وصول الموظف لفرع محدد
 */
export function canAccessBranch(
  userRole: SalonRole,
  userBranchId: string | null | undefined,
  targetBranchId: string,
  isSuperAdmin = false
): boolean {
  if (isSuperAdmin || userRole === 'saas_super_admin' || userRole === 'salon_owner') {
    return true; // المالك والسوبر أدمن يصلون لكافة الفروع
  }
  if (!userBranchId) {
    return false;
  }
  return userBranchId === targetBranchId;
}
