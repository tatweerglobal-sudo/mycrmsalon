-- ============================================================================
-- My CRM Salon — Multi-Tenant Beauty SaaS Foundation Schema
-- Migration: 005_tenant_invitations.sql
-- جدول دعوات مديري وصالونات المنصة (Tenant Onboarding Invitations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'salon_owner',
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON tenant_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON tenant_invitations(tenant_id);

-- السماح لـ salon_app_role بالوصول إذا لزم
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app_role') THEN
        GRANT SELECT, INSERT, UPDATE ON tenant_invitations TO salon_app_role;
    END IF;
END $$;
