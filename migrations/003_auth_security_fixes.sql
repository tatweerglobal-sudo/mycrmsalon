-- ============================================================================
-- My CRM Salon — Migration 003: Authentication Security Hardening & Isolation
-- Compatibility: PostgreSQL 14+ / Neon PostgreSQL
-- ============================================================================

-- 1. إضافة أعمدة تذاكر المصادقة اللحظية (Ephemeral Authentication Tickets)
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_ticket UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_ticket_expires_at TIMESTAMPTZ;

-- 2. تصحيح سياسة عزل تعديل جدول المستخدمين (users RLS)
-- يُحظر تماماً على أي موظف أو مستخدم تعديل سجل مستخدم آخر حتى لو كانا في نفس الصالون
DROP POLICY IF EXISTS user_isolation_update ON users;
CREATE POLICY user_isolation_update ON users
    FOR UPDATE
    USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- 3. تقييد الصلاحيات على مستوى الأعمدة (Column-Level Security) لدور التطبيق salon_app_role
-- سحب الصلاحيات السابقة بالكامل وإعادة منح الحد الأدنى فقط
REVOKE ALL ON TABLE users FROM salon_app_role;

-- السماح بالقراءة فقط للأعمدة غير الحساسة، وحجب password_hash و auth_ticket تماماً عن استعلامات التطبيق العادية
GRANT SELECT (id, email, phone_normalized, full_name, is_active, locked_until, token_version, created_at, updated_at) ON TABLE users TO salon_app_role;

-- السماح بالتعديل فقط للحقول الشخصية الأساسية، وحجب password_hash و token_version و is_super_admin و failed_login_attempts
GRANT UPDATE (full_name, phone_normalized, updated_at) ON TABLE users TO salon_app_role;

-- 4. إعادة بناء دوال المصادقة الآمنة المنضبطة بتذاكر المصادقة اللحظية

-- أ. دالة البحث عن الحساب وتوليد تذكرة المصادقة
DROP FUNCTION IF EXISTS auth_lookup_user_for_login(TEXT);
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
    token_version INT,
    auth_ticket UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_ticket UUID;
BEGIN
    SELECT u.id INTO v_user_id
    FROM users u
    WHERE LOWER(u.email) = LOWER(TRIM(p_email))
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        v_ticket := gen_random_uuid();
        UPDATE users
        SET auth_ticket = v_ticket,
            auth_ticket_expires_at = NOW() + INTERVAL '5 minutes'
        WHERE users.id = v_user_id;

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
            u.token_version,
            v_ticket AS auth_ticket
        FROM users u
        WHERE u.id = v_user_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_for_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_for_login(TEXT) TO salon_app_role;

-- ب. دالة تسجيل محاولة الدخول الفاشلة والتحقق من التذكرة
DROP FUNCTION IF EXISTS auth_record_login_failure(UUID);
CREATE OR REPLACE FUNCTION auth_record_login_failure(p_user_id UUID, p_ticket UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- التحقق الإلزامي من مطابقة التذكرة اللحظية وصلاحيتها الزمنية
    IF NOT EXISTS (
        SELECT 1 FROM users 
        WHERE id = p_user_id 
          AND auth_ticket IS NOT NULL 
          AND auth_ticket = p_ticket 
          AND auth_ticket_expires_at > NOW()
    ) THEN
        RAISE EXCEPTION 'SECURITY ERROR: Invalid or expired authentication ticket for user %', p_user_id
            USING ERRCODE = '42501';
    END IF;

    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE 
            WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
        END,
        auth_ticket = NULL,
        auth_ticket_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION auth_record_login_failure(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_record_login_failure(UUID, UUID) TO salon_app_role;

-- ج. دالة تسجيل نجاح الدخول وتصفير العدادات والتحقق من التذكرة
DROP FUNCTION IF EXISTS auth_record_login_success(UUID);
CREATE OR REPLACE FUNCTION auth_record_login_success(p_user_id UUID, p_ticket UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- التحقق الإلزامي من مطابقة التذكرة اللحظية
    IF NOT EXISTS (
        SELECT 1 FROM users 
        WHERE id = p_user_id 
          AND auth_ticket IS NOT NULL 
          AND auth_ticket = p_ticket 
          AND auth_ticket_expires_at > NOW()
    ) THEN
        RAISE EXCEPTION 'SECURITY ERROR: Invalid or expired authentication ticket for user %', p_user_id
            USING ERRCODE = '42501';
    END IF;

    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NOW(),
        auth_ticket = NULL,
        auth_ticket_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION auth_record_login_success(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_record_login_success(UUID, UUID) TO salon_app_role;

-- د. دالة استعلام المراكز المرتبطة مع حماية استعراض العضويات (Membership Enumeration Protection)
DROP FUNCTION IF EXISTS auth_get_user_tenants(UUID);
CREATE OR REPLACE FUNCTION auth_get_user_tenants(p_user_id UUID, p_ticket UUID DEFAULT NULL)
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
DECLARE
    v_current_user_id UUID;
BEGIN
    v_current_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;

    -- التحقق الأمني: مسموح فقط إذا كان المستخدم يستعلم عن نفسه بالجلسة النشطة،
    -- أو إذا كان يحمل تذكرة مصادقة نشطة وصالحة لحسابه
    IF (v_current_user_id IS NOT NULL AND v_current_user_id = p_user_id)
       OR (p_ticket IS NOT NULL AND EXISTS (
           SELECT 1 FROM users 
           WHERE id = p_user_id 
             AND auth_ticket IS NOT NULL 
             AND auth_ticket = p_ticket 
             AND auth_ticket_expires_at > NOW()
       )) THEN
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
    ELSE
        RAISE EXCEPTION 'SECURITY ERROR: Unauthorized attempt to enumerate user memberships for %', p_user_id
            USING ERRCODE = '42501';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION auth_get_user_tenants(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_user_tenants(UUID, UUID) TO salon_app_role;

-- هـ. دالة إبطال الجلسات الحية للمستخدم (Server-side Session Revocation)
CREATE OR REPLACE FUNCTION auth_revoke_user_sessions(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_user_id UUID;
BEGIN
    v_current_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;

    -- التحقق الأمني: لا يمكن للمستخدم إبطال جلسات غيره إلا لجلساته الشخصية
    IF v_current_user_id IS NULL OR v_current_user_id != p_user_id THEN
        RAISE EXCEPTION 'SECURITY ERROR: You can only revoke your own active sessions (caller: %, target: %)', v_current_user_id, p_user_id
            USING ERRCODE = '42501';
    END IF;

    UPDATE users
    SET token_version = token_version + 1,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION auth_revoke_user_sessions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_user_sessions(UUID) TO salon_app_role;
