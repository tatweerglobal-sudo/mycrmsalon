'use client';

import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit_price: string | number;
  cost_price: string | number;
  quantity: number;
  min_quantity: number;
  branch_name: string;
}

interface InventoryTransaction {
  id: string;
  transaction_type: string;
  quantity_delta: number;
  unit_cost: string | number;
  notes: string | null;
  created_at: string;
  product_name: string;
}

export default function InventoryView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // New Product Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('العناية بالشعر');
  const [unitPrice, setUnitPrice] = useState(85);
  const [costPrice, setCostPrice] = useState(45);
  const [quantity, setQuantity] = useState(10);
  const [minQuantity, setMinQuantity] = useState(3);

  // Stock Adjustment Modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [transType, setTransType] = useState<'in' | 'out' | 'adjustment'>('in');
  const [delta, setDelta] = useState(5);
  const [adjustNotes, setAdjustNotes] = useState('');

  // Status
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory');
      const data = await res.json();
      if (res.ok) {
        setProducts(data.products || []);
        setTransactions(data.recentTransactions || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sku: sku || undefined,
          category,
          unitPrice: Number(unitPrice),
          costPrice: Number(costPrice),
          quantity: Number(quantity),
          minQuantity: Number(minQuantity),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء حفظ المنتج');
      } else {
        setSuccess('تمت إضافة المنتج بنجاح');
        setTimeout(() => {
          setProductModalOpen(false);
          setSuccess(null);
          setName('');
          setSku('');
        }, 1200);
        loadInventory();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const openAdjustModal = (p: Product) => {
    setError(null);
    setSuccess(null);
    setSelectedProduct(p);
    setDelta(5);
    setAdjustNotes('');
    setAdjustModalOpen(true);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    const actualDelta = transType === 'out' ? -Math.abs(delta) : Math.abs(delta);

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_stock',
          productId: selectedProduct.id,
          type: transType,
          delta: actualDelta,
          notes: adjustNotes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء تعديل المخزون');
      } else {
        setSuccess('تم تسجيل حركة المخزون بنجاح');
        setTimeout(() => {
          setAdjustModalOpen(false);
          setSuccess(null);
          setSelectedProduct(null);
        }, 1200);
        loadInventory();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">المخزون والمنتجات</h2>
          <p className="text-xs text-slate-500">متابعة منتجات العناية، حركة التوريد، والتنبيه التلقائي لنقص الكميات</p>
        </div>

        <button
          onClick={() => { setError(null); setSuccess(null); setProductModalOpen(true); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ إضافة منتج جديد</span>
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل المخزون...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">📦</div>
          <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد منتجات مسجلة في المخزون حتى الآن</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
            أضيفي منتجات الصالون (كريمات، زيوت، صبغات، أدوات عناية) لمتابعة الأرصدة وتكلفة الخدمات.
          </p>
          <button
            onClick={() => setProductModalOpen(true)}
            className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            + إضافة أول منتج الآن
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">المنتج</th>
                    <th scope="col" className="px-5 py-3.5">التصنيف</th>
                    <th scope="col" className="px-5 py-3.5">الرصيد المتاح</th>
                    <th scope="col" className="px-5 py-3.5">سعر البيع</th>
                    <th scope="col" className="px-5 py-3.5">سعر التكلفة</th>
                    <th scope="col" className="px-5 py-3.5">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => {
                    const isLow = p.quantity <= p.min_quantity;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-5 py-4 font-bold text-slate-900">
                          <div>{p.name}</div>
                          {p.sku && <div className="font-mono text-[11px] text-slate-400">SKU: {p.sku}</div>}
                        </td>
                        <td className="px-5 py-4 text-xs font-medium text-slate-700">
                          {p.category}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`font-black ${isLow ? 'text-rose-700' : 'text-slate-900'}`}>
                              {p.quantity} قطعة
                            </span>
                            {isLow && (
                              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                                تنبيه نقص ⚠️
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-900">
                          {Number(p.unit_price).toLocaleString('ar-SA')} ر.س
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500">
                          {Number(p.cost_price).toLocaleString('ar-SA')} ر.س
                        </td>
                        <td className="px-5 py-4">
                          <button
                            onClick={() => openAdjustModal(p)}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-200 transition"
                          >
                            تعديل الرصيد 🔄
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transactions Log */}
          {transactions.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h3 className="text-sm font-black text-slate-900 mb-3">آخر حركات المخزون الموثقة</h3>
              <div className="divide-y divide-slate-100">
                {transactions.slice(0, 5).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-800">{t.product_name}</span>
                      <span className="mx-2 text-slate-400">•</span>
                      <span className="text-slate-500">{t.notes || 'حركة مخزون'}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`font-black font-mono ${t.quantity_delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`} dir="ltr">
                        {t.quantity_delta > 0 ? `+${t.quantity_delta}` : t.quantity_delta}
                      </span>
                      <span className="text-slate-400">
                        {new Date(t.created_at).toLocaleDateString('ar-SA')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal إضافة منتج */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">إضافة منتج جديد للمخزون</h3>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                {success}
              </div>
            )}

            <form onSubmit={handleCreateProduct} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">اسم المنتج *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: سيروم الأرجان المغربي المركز"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">رمز المنتج (SKU)</label>
                  <input
                    type="text"
                    placeholder="ARG-OIL-100"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    dir="ltr"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none text-right font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">التصنيف</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="العناية بالشعر">العناية بالشعر</option>
                    <option value="العناية بالبشرة">العناية بالبشرة</option>
                    <option value="الأظافر والباديكير">الأظافر والباديكير</option>
                    <option value="العطور والسبا">العطور والسبا</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">سعر البيع (ر.س) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">سعر التكلفة (ر.س) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">الرصيد الافتتاحي *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">حد التنبيه بالنقص</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ المنتج في المخزون'}
                </button>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal تعديل المخزون */}
      {adjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">حركة مخزون للمنتج</h3>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                {success}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
              <p><span className="font-bold text-slate-700">المنتج: </span>{selectedProduct.name}</p>
              <p className="mt-1"><span className="font-bold text-slate-700">الرصيد الحالي: </span>{selectedProduct.quantity} قطعة</p>
            </div>

            <form onSubmit={handleAdjustStock} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">نوع الحركة *</label>
                <select
                  value={transType}
                  onChange={(e) => setTransType(e.target.value as 'in' | 'out' | 'adjustment')}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="in">توريد وارد (+ زيادة الرصيد)</option>
                  <option value="out">صرف للاستخدام أو تالف (- إنقاص)</option>
                  <option value="adjustment">تسوية جرد دوري</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">الكمية *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={delta}
                  onChange={(e) => setDelta(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">ملاحظات الحركة (اختياري)</label>
                <input
                  type="text"
                  placeholder="رقم فاتورة المورد أو سبب الصرف..."
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || delta <= 0}
                  className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'جاري التعديل...' : 'تأكيد حركة المخزون'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
