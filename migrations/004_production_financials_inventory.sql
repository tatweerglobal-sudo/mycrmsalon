-- ============================================================================
-- My CRM Salon — Production Financials & Inventory Schema
-- Migration: 004_production_financials_inventory.sql
-- Adds: Invoices, Payments, Products, Inventory Transactions
-- Enforces: PostgreSQL Row Level Security (RLS) & Composite Foreign Keys
-- ============================================================================

-- 1. جدول الفواتير (Invoices)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    appointment_id UUID,
    invoice_number VARCHAR(50) NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'unpaid', -- unpaid, partially_paid, paid, refunded, cancelled
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoices_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_invoice_number UNIQUE (tenant_id, invoice_number),
    CONSTRAINT fk_invoice_tenant_branch FOREIGN KEY (tenant_id, branch_id)
        REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_tenant_customer FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoice_tenant_appointment FOREIGN KEY (tenant_id, appointment_id)
        REFERENCES appointments(tenant_id, id) ON DELETE SET NULL,
    CONSTRAINT chk_invoice_status CHECK (status IN (
        'unpaid', 'partially_paid', 'paid', 'refunded', 'cancelled'
    )),
    CONSTRAINT chk_invoice_amounts CHECK (total_amount >= 0 AND paid_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(tenant_id, created_at DESC);

-- 2. جدول المدفوعات والتحصيلات الفعلية (Payments)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'cash', -- cash, card, bank_transfer, pos, other
    reference_number VARCHAR(100),
    notes TEXT,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payments_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_payment_tenant_invoice FOREIGN KEY (tenant_id, invoice_id)
        REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_payment_amount CHECK (amount > 0),
    CONSTRAINT chk_payment_method CHECK (payment_method IN (
        'cash', 'card', 'bank_transfer', 'pos', 'other'
    ))
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(tenant_id, created_at DESC);

-- 3. جدول المنتجات والمخزون (Products / Inventory)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    category VARCHAR(100) NOT NULL DEFAULT 'العناية بالشعر',
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    cost_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 0,
    min_quantity INT NOT NULL DEFAULT 3,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_products_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_products_tenant_branch FOREIGN KEY (tenant_id, branch_id)
        REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_product_quantity CHECK (quantity >= 0),
    CONSTRAINT chk_product_prices CHECK (unit_price >= 0 AND cost_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_branch ON products(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(tenant_id, sku);

-- 4. حركة المخزون (Inventory Transactions)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    transaction_type VARCHAR(50) NOT NULL, -- in, out, sale, adjustment
    quantity_delta INT NOT NULL,
    unit_cost NUMERIC(10,2),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inv_trans_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_invtrans_tenant_product FOREIGN KEY (tenant_id, product_id)
        REFERENCES products(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_inv_type CHECK (transaction_type IN ('in', 'out', 'sale', 'adjustment'))
);

CREATE INDEX IF NOT EXISTS idx_inv_trans_tenant ON inventory_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_product ON inventory_transactions(tenant_id, product_id);

-- ============================================================================
-- 5. تفعيل Row Level Security (RLS) وسياسات العزل التام للمستأجرين
-- ============================================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions FORCE ROW LEVEL SECURITY;

-- سياسات invoices
DROP POLICY IF EXISTS invoice_tenant_isolation_select ON invoices;
CREATE POLICY invoice_tenant_isolation_select ON invoices
    FOR SELECT TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS invoice_tenant_isolation_insert ON invoices;
CREATE POLICY invoice_tenant_isolation_insert ON invoices
    FOR INSERT TO salon_app_role
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS invoice_tenant_isolation_update ON invoices;
CREATE POLICY invoice_tenant_isolation_update ON invoices
    FOR UPDATE TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- سياسات payments
DROP POLICY IF EXISTS payment_tenant_isolation_select ON payments;
CREATE POLICY payment_tenant_isolation_select ON payments
    FOR SELECT TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS payment_tenant_isolation_insert ON payments;
CREATE POLICY payment_tenant_isolation_insert ON payments
    FOR INSERT TO salon_app_role
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- سياسات products
DROP POLICY IF EXISTS product_tenant_isolation_select ON products;
CREATE POLICY product_tenant_isolation_select ON products
    FOR SELECT TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS product_tenant_isolation_insert ON products;
CREATE POLICY product_tenant_isolation_insert ON products
    FOR INSERT TO salon_app_role
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS product_tenant_isolation_update ON products;
CREATE POLICY product_tenant_isolation_update ON products
    FOR UPDATE TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS product_tenant_isolation_delete ON products;
CREATE POLICY product_tenant_isolation_delete ON products
    FOR DELETE TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- سياسات inventory_transactions
DROP POLICY IF EXISTS inv_trans_tenant_isolation_select ON inventory_transactions;
CREATE POLICY inv_trans_tenant_isolation_select ON inventory_transactions
    FOR SELECT TO salon_app_role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

DROP POLICY IF EXISTS inv_trans_tenant_isolation_insert ON inventory_transactions;
CREATE POLICY inv_trans_tenant_isolation_insert ON inventory_transactions
    FOR INSERT TO salon_app_role
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- ============================================================================
-- 6. منح الصلاحيات المقيدة لـ salon_app_role
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON TABLE invoices TO salon_app_role;
GRANT SELECT, INSERT ON TABLE payments TO salon_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE products TO salon_app_role;
GRANT SELECT, INSERT ON TABLE inventory_transactions TO salon_app_role;
