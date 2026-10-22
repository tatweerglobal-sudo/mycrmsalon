-- ============================================================================
-- My CRM Salon — Migration 002: Security Hardening & Least-Privilege RLS
-- Compatibility: PostgreSQL 14+ / Neon PostgreSQL
-- ============================================================================

-- 1. تفعيل وفرض أمان الصفوف (FORCE RLS) على جدولي tenants و users لمنع أي قراءة أو تعديل شامل
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- 2. سياسات عزل المستأجر لجدول tenants
-- المستخدم العادي يرى ويعدل فقط صالونه الخاص المحدد بسياق الجلسة app.current_tenant_id
DROP POLICY IF EXISTS tenant_isolation_tenants_select ON tenants;
CREATE POLICY tenant_isolation_tenants_select ON tenants
    FOR SELECT
    USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_tenants_update ON tenants;
CREATE POLICY tenant_isolation_tenants_update ON tenants
    FOR UPDATE
    USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 3. سياسات عزل المستخدمين لجدول users
-- المستخدم يرى حسابه الشخصي أو زملاءه المنتمين لنفس الصالون المحدد بسياق الجلسة
DROP POLICY IF EXISTS user_isolation_select ON users;
CREATE POLICY user_isolation_select ON users
    FOR SELECT
    USING (
        id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        OR id IN (
            SELECT user_id FROM memberships 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );

DROP POLICY IF EXISTS user_isolation_update ON users;
CREATE POLICY user_isolation_update ON users
    FOR UPDATE
    USING (
        id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        OR id IN (
            SELECT user_id FROM memberships 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    )
    WITH CHECK (
        id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        OR id IN (
            SELECT user_id FROM memberships 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );

-- 4. تقييد الصلاحيات على مستوى الأعمدة (Column-Level Security) لدور salon_app_role
-- حظر التعديل على الحقول الحساسة (الاشتراكات، الباقات، رتبة super_admin)

-- جدول tenants: سحب التعديل الشامل ومنح التعديل فقط للبيانات العامة للمركز
REVOKE ALL ON TABLE tenants FROM salon_app_role;
GRANT SELECT ON TABLE tenants TO salon_app_role;
GRANT UPDATE (name, timezone, currency, contact_phone, contact_email, settings, updated_at) ON TABLE tenants TO salon_app_role;

-- جدول users: سحب التعديل الشامل وحظر تعديل رتبة is_super_admin نهائياً
REVOKE ALL ON TABLE users FROM salon_app_role;
GRANT SELECT ON TABLE users TO salon_app_role;
GRANT INSERT (id, email, phone_normalized, full_name, password_hash, is_active, token_version) ON TABLE users TO salon_app_role;
GRANT UPDATE (full_name, phone_normalized, password_hash, token_version, last_login_at, failed_login_attempts, locked_until, updated_at) ON TABLE users TO salon_app_role;

-- 5. دوال المصادقة الآمنة المنضبطة (SECURITY DEFINER Authentication Functions)
-- تتيح البحث عن الحساب والتحقق من كلمة المرور دون السماح لدور التطبيق بتجاوز RLS أو قراءة بيانات الآخرين

CREATE OR REPLACE FUNCTION auth_lookup_user_for_login(p_email TEXT)
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    full_name VARCHAR(255),
    password_hash VARCHAR(255),
    is_super_admin BOOLEAN,
    is_active BOOLEAN,
    failed_login_attempts INT,
    locked_until TIMESTAMPTZ,
    token_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email,
        u.full_name,
        u.password_hash,
        u.is_super_admin,
        u.is_active,
        u.failed_login_attempts,
        u.locked_until,
        u.token_version
    FROM users u
    WHERE LOWER(u.email) = LOWER(TRIM(p_email))
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION auth_lookup_user_for_login(TEXT) TO salon_app_role;

CREATE OR REPLACE FUNCTION auth_get_user_tenants(p_user_id UUID)
RETURNS TABLE (
    membership_id UUID,
    tenant_id UUID,
    tenant_name VARCHAR(255),
    tenant_slug VARCHAR(100),
    tenant_status VARCHAR(50),
    subscription_tier VARCHAR(50),
    role VARCHAR(50),
    branch_id UUID,
    membership_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id AS membership_id,
        t.id AS tenant_id,
        t.name AS tenant_name,
        t.slug AS tenant_slug,
        t.status AS tenant_status,
        t.subscription_tier,
        m.role,
        m.branch_id,
        m.is_active AS membership_active
    FROM memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id AND m.is_active = true AND t.status != 'cancelled'
    ORDER BY t.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION auth_get_user_tenants(UUID) TO salon_app_role;

CREATE OR REPLACE FUNCTION auth_record_login_success(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth_record_login_success(UUID) TO salon_app_role;

CREATE OR REPLACE FUNCTION auth_record_login_failure(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE 
            WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth_record_login_failure(UUID) TO salon_app_role;
