'use client';

import { useState, useEffect } from 'react';

interface Invoice {
  id: string;
  invoice_number: string;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  paid_amount: string | number;
  status: string;
  notes: string | null;
  created_at: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
}

interface Payment {
  id: string;
  amount: string | number;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  invoice_number: string;
  customer_name: string;
}

interface CustomerOption {
  id: string;
  full_name: string;
  phone_normalized: string;
}

export default function FinancialsView() {
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // New Invoice Modal
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [subtotal, setSubtotal] = useState(200);
  const [discount, setDiscount] = useState(0);
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Payment Modal
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('card');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // Status
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invRes, payRes] = await Promise.all([
        fetch('/api/invoices'),
        fetch('/api/payments'),
      ]);
      const invData = await invRes.json();
      const payData = await payRes.json();

      if (invRes.ok) setInvoices(invData.invoices || []);
      if (payRes.ok) setPayments(payData.payments || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openInvoiceModal = async () => {
    setError(null);
    setSuccess(null);
    try {
      const cRes = await fetch('/api/customers');
      const cData = await cRes.json();
      if (cRes.ok) setCustomers(cData.customers || []);
    } catch (_err) {
      // ignore
    }
    setInvoiceModalOpen(true);
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          subtotal: Number(subtotal),
          discountAmount: Number(discount),
          notes: invoiceNotes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء إصدار الفاتورة');
      } else {
        setSuccess('تم إصدار الفاتورة بنجاح');
        setTimeout(() => {
          setInvoiceModalOpen(false);
          setSuccess(null);
          setSelectedCustomerId('');
          setInvoiceNotes('');
        }, 1200);
        loadData();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const openPaymentModal = (inv: Invoice) => {
    setError(null);
    setSuccess(null);
    setSelectedInvoice(inv);
    const remaining = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount));
    setPayAmount(remaining);
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          amount: Number(payAmount),
          paymentMethod: payMethod,
          referenceNumber: payRef || undefined,
          notes: payNotes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء تسجيل الدفعة');
      } else {
        setSuccess('تم تسجيل الدفعة وتحديث الفاتورة وسجل العميلة بنجاح');
        setTimeout(() => {
          setPaymentModalOpen(false);
          setSuccess(null);
          setSelectedInvoice(null);
          setPayRef('');
          setPayNotes('');
        }, 1200);
        loadData();
      }
    } catch (_err) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const calcTax = Math.round(Math.max(0, subtotal - discount) * 0.15 * 100) / 100;
  const calcTotal = Math.round((Math.max(0, subtotal - discount) + calcTax) * 100) / 100;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">مسددة بالكامل</span>;
      case 'partially_paid':
        return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">مسددة جزئياً</span>;
      case 'unpaid':
        return <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">غير مسددة</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{status}</span>;
    }
  };

  const getMethodLabel = (m: string) => {
    switch (m) {
      case 'cash': return 'نقداً 💵';
      case 'card': return 'بطاقة مدى / ائتمان 💳';
      case 'pos': return 'جهاز نقاط البيع (POS) 📠';
      case 'bank_transfer': return 'تحويل بنكي 🏦';
      default: return m;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Tabs & Add Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeTab === 'invoices'
                ? 'bg-rose-800 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            سجل الفواتير ({invoices.length})
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeTab === 'payments'
                ? 'bg-rose-800 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            سجل التحصيلات والمدفوعات ({payments.length})
          </button>
        </div>

        <button
          onClick={openInvoiceModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
        >
          <span>+ إصدار فاتورة جديدة</span>
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <p className="text-sm font-bold text-slate-500">جاري تحميل السجلات المالية...</p>
        </div>
      ) : activeTab === 'invoices' ? (
        invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">💳</div>
            <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد فواتير صادرة حتى الآن</h3>
            <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
              ابدئي بإصدار أول فاتورة لخدمات الصالون أو مبيعات المنتجات مع احتساب ضريبة القيمة المضافة (15%) تلقائياً.
            </p>
            <button
              onClick={openInvoiceModal}
              className="mt-5 rounded-xl bg-rose-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
            >
              + إصدار أول فاتورة الآن
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">رقم الفاتورة</th>
                    <th scope="col" className="px-5 py-3.5">العميلة</th>
                    <th scope="col" className="px-5 py-3.5">الإجمالي مع الضريبة</th>
                    <th scope="col" className="px-5 py-3.5">المبلغ المسدد</th>
                    <th scope="col" className="px-5 py-3.5">الحالة</th>
                    <th scope="col" className="px-5 py-3.5">التاريخ</th>
                    <th scope="col" className="px-5 py-3.5">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-4 font-mono text-xs font-bold text-rose-800">
                        {inv.invoice_number}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-900">
                        {inv.customer_name}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-900">
                        {Number(inv.total_amount).toLocaleString('ar-SA')} ر.س
                      </td>
                      <td className="px-5 py-4 font-medium text-emerald-700">
                        {Number(inv.paid_amount).toLocaleString('ar-SA')} ر.س
                      </td>
                      <td className="px-5 py-4">
                        {getStatusBadge(inv.status)}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">
                        {new Date(inv.created_at).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="px-5 py-4">
                        {inv.status !== 'paid' && (
                          <button
                            onClick={() => openPaymentModal(inv)}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition"
                          >
                            تسجيل دفعة 💵
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl">💵</div>
            <h3 className="mt-4 text-base font-bold text-slate-900">لا توجد مدفوعات مسجلة حتى الآن</h3>
            <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
              عند سداد الفواتير نقداً أو بالشبكة، ستظهر جميع حركات التحصيل هنا موثقة بالكامل.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">الفاتورة</th>
                    <th scope="col" className="px-5 py-3.5">العميلة</th>
                    <th scope="col" className="px-5 py-3.5">المبلغ المحصل</th>
                    <th scope="col" className="px-5 py-3.5">طريقة الدفع</th>
                    <th scope="col" className="px-5 py-3.5">الرقم المرجعي</th>
                    <th scope="col" className="px-5 py-3.5">وقت التحصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-4 font-mono text-xs font-bold text-rose-800">
                        {p.invoice_number}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-900">
                        {p.customer_name}
                      </td>
                      <td className="px-5 py-4 font-black text-emerald-700">
                        {Number(p.amount).toLocaleString('ar-SA')} ر.س
                      </td>
                      <td className="px-5 py-4 text-xs font-medium text-slate-700">
                        {getMethodLabel(p.payment_method)}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-500">
                        {p.reference_number || '-'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">
                        {new Date(p.created_at).toLocaleString('ar-SA')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Modal إصدار فاتورة */}
      {invoiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">إصدار فاتورة جديدة</h3>
              <button
                type="button"
                onClick={() => setInvoiceModalOpen(false)}
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

            <form onSubmit={handleCreateInvoice} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">العميلة *</label>
                <select
                  required
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">-- اختاري العميلة --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.phone_normalized})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">المبلغ الأولي (ر.س) *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={subtotal}
                    onChange={(e) => setSubtotal(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">قيمة الخصم (ر.س)</label>
                  <input
                    type="number"
                    min="0"
                    max={subtotal}
                    step="1"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>الخاضع للضريبة:</span>
                  <span>{Math.max(0, subtotal - discount)} ر.س</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ضريبة القيمة المضافة (15%):</span>
                  <span>{calcTax} ر.س</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
                  <span>الإجمالي النهائي المستحق:</span>
                  <span className="text-rose-800 text-sm">{calcTotal} ر.س</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">ملاحظات الفاتورة (اختياري)</label>
                <textarea
                  rows={2}
                  placeholder="ملاحظات حول الخدمات أو أرقام جلسات الباقة..."
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || !selectedCustomerId}
                  className="flex-1 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {saving ? 'جاري الإصدار...' : 'إصدار الفاتورة'}
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal تسجيل دفعة */}
      {paymentModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-black text-slate-900">تسجيل دفعة للفاتورة</h3>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
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

            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs space-y-1">
              <p><span className="font-bold text-slate-700">الفاتورة: </span>{selectedInvoice.invoice_number}</p>
              <p><span className="font-bold text-slate-700">العميلة: </span>{selectedInvoice.customer_name}</p>
              <p><span className="font-bold text-slate-700">المتبقي: </span>
                <span className="font-bold text-rose-800">
                  {(Number(selectedInvoice.total_amount) - Number(selectedInvoice.paid_amount)).toFixed(2)} ر.س
                </span>
              </p>
            </div>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">مبلغ التحصيل (ر.س) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Number(selectedInvoice.total_amount) - Number(selectedInvoice.paid_amount)}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">طريقة الدفع *</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                >
                  <option value="card">بطاقة مدى / ائتمان 💳</option>
                  <option value="pos">جهاز نقاط البيع (POS) 📠</option>
                  <option value="cash">نقداً 💵</option>
                  <option value="bank_transfer">تحويل بنكي 🏦</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">الرقم المرجعي للإيصال (اختياري)</label>
                <input
                  type="text"
                  placeholder="رقم عملية الشبكة أو التحويل..."
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || payAmount <= 0}
                  className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? 'جاري التسجيل...' : 'تأكيد السداد والتحصيل'}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
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
