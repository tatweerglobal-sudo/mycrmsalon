-- ============================================================================
-- My CRM Salon — Multi-Tenant Beauty SaaS Foundation Schema
-- Migration: 001_initial_saas_schema.sql
-- Compatibility: PostgreSQL 14+ / Neon PostgreSQL
-- ============================================================================

-- 1. تفعيل الامتدادات الضرورية (UUID v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. جدول المستأجرين (Tenants / مراكز التجميل المشتركة)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    country_code VARCHAR(2) NOT NULL DEFAULT 'SA', -- ISO 3166-1 alpha-2 (SA, EG, AE, DE, etc.)
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Riyadh',
    currency VARCHAR(10) NOT NULL DEFAULT 'SAR',
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'trial', 'active', 'suspended', 'cancelled'
    subscription_tier VARCHAR(50) NOT NULL DEFAULT 'starter', -- 'trial', 'starter', 'growth', 'enterprise'
    subscription_expires_at TIMESTAMPTZ,
    max_branches INT NOT NULL DEFAULT 1,
    max_staff INT NOT NULL DEFAULT 5,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- ============================================================================
-- 3. جدول فروع مركز التجميل (Branches)
-- ============================================================================
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    is_main BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    opening_time TIME DEFAULT '09:00:00',
    closing_time TIME DEFAULT '22:00:00',
    working_days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb, -- 0=Sun, 6=Sat
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_branch_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);

-- ============================================================================
-- 4. جدول المستخدمين الموحد (Users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_normalized VARCHAR(50),
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_super_admin BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_normalized);

-- ============================================================================
-- 5. جدول العضويات والصلاحيات (Memberships / Tenant Users)
-- يربط المستخدم بمركز تجميل محدد مع دوره والفرع المخصص
-- ============================================================================
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    -- الأدوار المعتمدة:
    -- 'salon_owner': مالك المركز (كامل الصلاحيات)
    -- 'salon_manager': مدير المركز
    -- 'receptionist': موظف استقبال (حجوزات وعملاء)
    -- 'beauty_specialist': خبيرة تجميل (مواعيدها وخدماتها)
    -- 'accountant': محاسب (فواتير وتقارير مالية)
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT chk_valid_role CHECK (role IN (
        'salon_owner',
        'salon_manager',
        'receptionist',
        'beauty_specialist',
        'accountant'
    ))
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON memberships(tenant_id, role);

-- ============================================================================
-- 6. جدول خبراء وأخصائيات التجميل (Salon Staff)
-- ============================================================================
CREATE TABLE IF NOT EXISTS salon_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name VARCHAR(255) NOT NULL,
    title VARCHAR(150), -- e.g. 'أخصائية عناية بالبشرة', 'خبيرة شعر ومكياج'
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00, -- نسبة العمولة %
    color_code VARCHAR(10) NOT NULL DEFAULT '#9d174d',
    is_active BOOLEAN NOT NULL DEFAULT true,
    schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_commission_rate CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

CREATE INDEX IF NOT EXISTS idx_staff_tenant ON salon_staff(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_branch ON salon_staff(branch_id);

-- ============================================================================
-- 7. جدول العملاء (Customers CRM)
-- رقم الهاتف فريد على مستوى المستأجر الواحد وليس عالمياً
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    phone_raw VARCHAR(50),
    phone_normalized VARCHAR(50) NOT NULL, -- بصيغة E.164 الدولية
    country_code VARCHAR(2) NOT NULL DEFAULT 'SA',
    email VARCHAR(255),
    notes TEXT,
    preferences TEXT, -- تفضيلات العناية، نوع البشرة، المواد المفضلة
    loyalty_points INT NOT NULL DEFAULT 0,
    total_visits INT NOT NULL DEFAULT 0,
    total_spent NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    last_visit_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_customer_phone UNIQUE (tenant_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(tenant_id, full_name);

-- ============================================================================
-- 8. تصنيفات الخدمات غير الطبية (Service Categories)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_category_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON service_categories(tenant_id);

-- ============================================================================
-- 9. الخدمات غير الطبية والباقات (Services & Packages)
-- ============================================================================
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL DEFAULT 30,
    buffer_minutes INT NOT NULL DEFAULT 0, -- وقت راحة أو تعقيم بعد الجلسة
    price NUMERIC(10,2) NOT NULL,
    is_package BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_service_name UNIQUE (tenant_id, name),
    CONSTRAINT chk_service_price CHECK (price >= 0),
    CONSTRAINT chk_service_duration CHECK (duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);

-- ============================================================================
-- 10. جدول ربط الخبيرات بالخدمات (Staff Services)
-- ============================================================================
CREATE TABLE IF NOT EXISTS staff_services (
    staff_id UUID NOT NULL REFERENCES salon_staff(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    custom_price NUMERIC(10,2), -- سعر خاص إذا كان للخبير تسعير مختلف
    custom_duration_minutes INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_services_tenant ON staff_services(tenant_id);

-- ============================================================================
-- 11. جدول الحجوزات والمواعيد (Appointments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    staff_id UUID REFERENCES salon_staff(id) ON DELETE SET NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'booked',
    -- 'booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    total_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    final_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid', -- 'unpaid', 'partially_paid', 'paid', 'refunded'
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_appointment_times CHECK (ends_at > starts_at),
    CONSTRAINT chk_appointment_status CHECK (status IN (
        'booked',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'no_show'
    ))
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_dates ON appointments(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(tenant_id, staff_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(tenant_id, status);

-- ============================================================================
-- 12. الخدمات المتضمنة في الحجز (Appointment Services)
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointment_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES salon_staff(id) ON DELETE SET NULL,
    price NUMERIC(10,2) NOT NULL,
    duration_minutes INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apt_services_apt ON appointment_services(appointment_id);
CREATE INDEX IF NOT EXISTS idx_apt_services_tenant ON appointment_services(tenant_id);

-- ============================================================================
-- 13. سجل التدقيق والحماية (Audit Logs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ============================================================================
-- 14. تفعيل أمان الصفوف (PostgreSQL Row-Level Security - RLS)
-- ============================================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- السياسات الأمنية تعتمد على متغير جلسة آمن: `app.current_tenant_id`
-- يتم ضبطه في كل اتصال عبر دالة الـ Backend الموثقة
CREATE POLICY tenant_isolation_branches ON branches
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_memberships ON memberships
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_staff ON salon_staff
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_customers ON customers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_categories ON service_categories
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_services ON services
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_staff_services ON staff_services
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_appointments ON appointments
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_apt_services ON appointment_services
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
