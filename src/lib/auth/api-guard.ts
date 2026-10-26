// src/lib/auth/api-guard.ts
// حماية الواجهات البرمجية (API Routes Guard)
// يتحقق من الجلسة الحية في Neon DB ويفرض نظام الصلاحيات (RBAC) وعزل المستأجرين (Tenant Isolation)

import { NextRequest, NextResponse } from 'next/server';
import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { getSessionFromRequest, validateSessionState, type SessionPayload } from './session';
import { hasPermission, canAccessBranch, type Permission, type SalonRole } from './roles';

export interface ApiAuthOptions {
  permission?: Permission;
  requireSuperAdmin?: boolean;
  allowedRoles?: SalonRole[];
  targetBranchId?: string | null;
}

export type ApiAuthResult =
  | {
      ok: true;
      session: SessionPayload;
      pool: Pool;
      tenantId: string;
      userId: string;
      role: SalonRole;
      isSuperAdmin: boolean;
      branchId: string | null;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * فحص أمني مركزي لكافة API Routes:
 * 1. استخراج والتحقق التشفيري من التوكن
 * 2. التحقق الحي من Neon DB (المستخدم نشط، التوكن لم يُبطل، الصالون غير معلق، العضوية سارية)
 * 3. التحقق من صلاحيات RBAC
 * 4. التحقق من صلاحية الوصول للفرع
 * 5. اشتقاق tenant_id حصرياً من الجلسة المعتمدة
 */
export async function requireApiAuth(
  req: NextRequest,
  options?: ApiAuthOptions
): Promise<ApiAuthResult> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'غير مصرح به: يلزم تسجيل الدخول للوصول إلى بيانات المركز (Unauthorized).' },
        { status: 401 }
      ),
    };
  }

  const pool = getDbPool();

  try {
    const liveCheck = await validateSessionState(pool, session);
    if (!liveCheck.valid) {
      const isSuspended =
        liveCheck.reason?.includes('موقوف') ||
        liveCheck.reason?.includes('معلق') ||
        liveCheck.reason?.includes('اشتراك');

      const status = isSuspended ? 403 : 401;
      const code = isSuspended ? 'TENANT_SUSPENDED' : 'SESSION_REVOKED';

      const res = NextResponse.json(
        { error: liveCheck.reason || 'تم إبطال صلاحية هذه الجلسة', code },
        { status }
      );
      if (!isSuspended) {
        res.cookies.delete('salon_session');
      }
      return { ok: false, response: res };
    }
  } catch (err) {
    console.error('[requireApiAuth] Database session validation error:', err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'حدث خطأ أثناء التحقق من صلاحية الجلسة' },
        { status: 500 }
      ),
    };
  }

  // فحص حصرية Super Admin
  if (options?.requireSuperAdmin && !session.isSuperAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'غير مصرح به: هذه العملية مخصصة لمدير المنصة (Super Admin) فقط.' },
        { status: 403 }
      ),
    };
  }

  // فحص الأدوار المسموح بها (إن حُددت)
  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    if (!session.isSuperAdmin && !options.allowedRoles.includes(session.role)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'غير مصرح به: دورك الوظيفي الحالي لا يملك صلاحية تنفيذ هذه العملية.' },
          { status: 403 }
        ),
      };
    }
  }

  // فحص صلاحية الـ RBAC
  if (options?.permission) {
    if (!hasPermission(session.role, options.permission, session.isSuperAdmin)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'غير مصرح به: ليس لديك الصلاحية الكافية لإتمام هذا الإجراء.' },
          { status: 403 }
        ),
      };
    }
  }

  // فحص الوصول للفرع المحدد
  if (options?.targetBranchId) {
    if (!canAccessBranch(session.role, session.branchId, options.targetBranchId, session.isSuperAdmin)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'غير مصرح به: ليس لديك صلاحية الوصول إلى بيانات هذا الفرع.' },
          { status: 403 }
        ),
      };
    }
  }

  return {
    ok: true,
    session,
    pool,
    tenantId: session.tenantId,
    userId: session.userId,
    role: session.role,
    isSuperAdmin: Boolean(session.isSuperAdmin),
    branchId: session.branchId || null,
  };
}
