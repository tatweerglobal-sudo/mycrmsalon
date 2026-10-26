// src/app/api/admin/tenants/[id]/invite/route.ts
// إصدار وإعادة إصدار رابط دعوة آمن لمالك الصالون (Reissue Tenant Invitation)

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getMigrationDbPool } from '@/lib/db';
import { requireApiAuth } from '@/lib/auth/api-guard';
import { validateRequestOrigin } from '@/lib/auth/csrf';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const auth = await requireApiAuth(req, { requireSuperAdmin: true });
  if (!auth.ok) return auth.response;

  const tenantId = params.id;
  if (!tenantId) {
    return NextResponse.json({ error: 'معرف مركز التجميل مطلوب' }, { status: 400 });
  }

  try {
    const pool = getMigrationDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // التحقق من وجود الصالون ومالكه
      const tenantRes = await client.query(
        `SELECT t.id, t.name, t.slug, u.email as owner_email, u.full_name as owner_name
         FROM tenants t
         LEFT JOIN memberships m ON m.tenant_id = t.id AND m.role = 'salon_owner'
         LEFT JOIN users u ON u.id = m.user_id
         WHERE t.id = $1 LIMIT 1`,
        [tenantId]
      );

      if (tenantRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'مركز التجميل غير موجود' }, { status: 404 });
      }

      const tenant = tenantRes.rows[0];
      const ownerEmail = tenant.owner_email || tenant.contact_email;

      if (!ownerEmail) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'لم يتم العثور على بريد إلكتروني مسجل لمالك هذا المركز' }, { status: 400 });
      }

      // إلغاء الدعوات السابقة غير المستخدمة لهذا الصالون
      await client.query(
        `UPDATE tenant_invitations
         SET expires_at = NOW()
         WHERE tenant_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [tenantId]
      );

      // توليد رمز دعوة عشوائي مشفر
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 أيام

      await client.query(
        `INSERT INTO tenant_invitations (
           tenant_id, email, role, token, expires_at, created_by
         ) VALUES ($1, $2, 'salon_owner', $3, $4, $5)`,
        [tenantId, ownerEmail, inviteToken, expiresAt, auth.userId]
      );

      // تسجيل العملية في سجل التدقيق
      await client.query(
        `INSERT INTO audit_logs (
           tenant_id, user_id, action, resource_type, resource_id, details
         ) VALUES ($1, $2, 'invitation_reissued', 'tenant_invitation', $3, $4)`,
        [
          tenantId,
          auth.userId,
          inviteToken.slice(0, 8),
          JSON.stringify({ ownerEmail, expiresAt }),
        ]
      );

      await client.query('COMMIT');

      const protocol = req.nextUrl.protocol || 'https:';
      const host = req.headers.get('host') || 'crmsalon.de';
      const inviteUrl = `${protocol}//${host}/invite?token=${inviteToken}`;

      return NextResponse.json({
        success: true,
        message: 'تم إصدار رابط دعوة جديد بنجاح',
        invite: {
          token: inviteToken,
          inviteUrl,
          expiresAt: expiresAt.toISOString(),
          recipient: ownerEmail,
          salonName: tenant.name,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Reissue invite error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء إصدار رابط الدعوة' }, { status: 500 });
  }
}
