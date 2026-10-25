// src/app/api/inventory/route.ts
// الواجهة البرمجية لإدارة المنتجات والمخزون وحركة التوريد (Inventory API)

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifySessionToken } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import { withTenantDb } from '@/lib/auth/tenant-context';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

function getSessionFromRequest(req: NextRequest) {
  const cookie = req.cookies.get('salon_session')?.value;
  if (!cookie) return null;
  return verifySessionToken(cookie);
}

// 1. استعراض المنتجات والمخزون
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q')?.trim();
  const lowStockOnly = searchParams.get('lowStock') === 'true';

  try {
    const pool = getDbPool();
    const data = await withTenantDb(pool, session, async (client) => {
      let query = `
        SELECT p.id, p.name, p.sku, p.category, p.unit_price, p.cost_price,
               p.quantity, p.min_quantity, p.is_active, p.created_at,
               b.id as branch_id, b.name as branch_name
        FROM products p
        JOIN branches b ON p.branch_id = b.id
        WHERE p.is_active = true
      `;
      const params: unknown[] = [];
      let idx = 1;

      if (search) {
        query += ` AND (p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.category ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }

      if (lowStockOnly) {
        query += ` AND p.quantity <= p.min_quantity`;
      }

      query += ` ORDER BY p.name ASC LIMIT 150`;

      const productsRes = await client.query(query, params);

      // جلب آخر حركات المخزون
      const transRes = await client.query(`
        SELECT t.id, t.transaction_type, t.quantity_delta, t.unit_cost, t.notes, t.created_at,
               p.name as product_name
        FROM inventory_transactions t
        JOIN products p ON t.product_id = p.id
        ORDER BY t.created_at DESC
        LIMIT 20
      `);

      return {
        products: productsRes.rows,
        recentTransactions: transRes.rows,
      };
    });

    return NextResponse.json({ success: true, ...data });
  } catch (err: unknown) {
    console.error('Error fetching inventory:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء جلب بيانات المخزون' }, { status: 500 });
  }
}

// 2. إضافة منتج جديد أو تسجيل حركة مخزون
export async function POST(req: NextRequest) {
  const originCheck = validateRequestOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json({ error: 'طلب غير مصرح به: مخالفة حماية المصدر (CSRF)' }, { status: 403 });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى تسجيل الدخول' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action } = body; // 'create_product' or 'adjust_stock'

    const pool = getDbPool();

    if (action === 'adjust_stock') {
      const { productId, type, delta, notes } = body;
      const validTypes = ['in', 'out', 'adjustment', 'sale'];
      if (!productId || !validTypes.includes(type)) {
        return NextResponse.json({ error: 'نوع الحركة ومعرف المنتج مطلوبان' }, { status: 400 });
      }

      const quantityDelta = Number(delta);
      if (isNaN(quantityDelta) || quantityDelta === 0) {
        return NextResponse.json({ error: 'الكمية يجب أن تكون رقماً لا يساوي صفراً' }, { status: 400 });
      }

      const res = await withTenantDb(pool, session, async (client, ctx) => {
        // فحص المنتج
        const pRes = await client.query('SELECT id, quantity, cost_price FROM products WHERE id = $1', [productId]);
        if (pRes.rows.length === 0) {
          throw new Error('المنتج غير موجود');
        }

        const currentQty = pRes.rows[0].quantity;
        const newQty = currentQty + quantityDelta;
        if (newQty < 0) {
          throw new Error(`الكمية المتاحة (${currentQty}) لا تكفي لإجراء هذه الحركة`);
        }

        // تحديث كمية المنتج
        await client.query('UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2', [newQty, productId]);

        // تسجيل الحركة
        const transRes = await client.query(`
          INSERT INTO inventory_transactions (
            tenant_id, product_id, transaction_type, quantity_delta, unit_cost, notes, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          ) RETURNING id, transaction_type, quantity_delta, created_at;
        `, [
          ctx.tenantId,
          productId,
          type,
          quantityDelta,
          pRes.rows[0].cost_price,
          notes?.trim() || null,
          ctx.userId
        ]);

        return { newQuantity: newQty, transaction: transRes.rows[0] };
      });

      return NextResponse.json({
        success: true,
        message: 'تم تعديل كمية المخزون وتسجيل الحركة بنجاح',
        ...res,
      });
    }

    // Default: create product
    const { name, sku, category, unitPrice, costPrice, quantity, minQuantity, branchId } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'اسم المنتج مطلوب ولا يقل عن حرفين' }, { status: 400 });
    }

    const price = Number(unitPrice || 0);
    const cost = Number(costPrice || 0);
    const qty = Number(quantity || 0);
    const minQty = Number(minQuantity || 3);

    const newProduct = await withTenantDb(pool, session, async (client, ctx) => {
      let resolvedBranchId = branchId;
      if (!resolvedBranchId) {
        const branchRes = await client.query('SELECT id FROM branches WHERE is_main = true LIMIT 1');
        resolvedBranchId = branchRes.rows[0]?.id;
        if (!resolvedBranchId) {
          const anyB = await client.query('SELECT id FROM branches LIMIT 1');
          resolvedBranchId = anyB.rows[0]?.id;
        }
      }

      if (!resolvedBranchId) {
        throw new Error('لا يوجد فرع لإضافة المنتج إليه');
      }

      const res = await client.query(`
        INSERT INTO products (
          tenant_id, branch_id, name, sku, category, unit_price, cost_price, quantity, min_quantity, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, true
        ) RETURNING id, name, sku, category, unit_price, cost_price, quantity, min_quantity, created_at;
      `, [
        ctx.tenantId,
        resolvedBranchId,
        name.trim(),
        sku?.trim() || null,
        category?.trim() || 'العناية بالشعر',
        price,
        cost,
        qty,
        minQty
      ]);

      const prod = res.rows[0];

      // إذا كانت الكمية الابتدائية أكبر من 0، نسجل حركة توريد أولية
      if (qty > 0) {
        await client.query(`
          INSERT INTO inventory_transactions (
            tenant_id, product_id, transaction_type, quantity_delta, unit_cost, notes, created_by
          ) VALUES (
            $1, $2, 'in', $3, $4, 'رصيد افتتاحي للمنتج', $5
          );
        `, [ctx.tenantId, prod.id, qty, cost, ctx.userId]);
      }

      return prod;
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة المنتج بنجاح',
      product: newProduct,
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('Error in inventory API:', err);
    return NextResponse.json({ error: (err as Error).message || 'حدث خطأ أثناء معالجة المخزون' }, { status: 500 });
  }
}
