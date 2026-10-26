'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function InviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<{
    email: string;
    salonName: string;
    ownerName: string;
  } | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('رابط الدعوة غير صالح أو مفقود.');
      setLoading(false);
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await fetch(`/api/auth/setup-password?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && data.valid) {
          setInviteData(data);
        } else {
          setError(data.error || 'رابط الدعوة غير صالح أو منتهي الصلاحية.');
        }
      } catch (_err) {
        setError('تعذر الاتصال بالخادم للتحقق من رابط الدعوة.');
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (password.length < 8) {
      setError('يجب ألا تقل كلمة المرور عن 8 خانات.');
      return;
    }

    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء إعداد كلمة المرور.');
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      if (data.token && typeof window !== 'undefined') {
        try {
          localStorage.setItem('salon_token', data.token);
          sessionStorage.setItem('salon_token', data.token);
        } catch (_e) {}
      }

      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (_err) {
      setError('فشل إرسال الطلب، يرجى المحاولة مرة أخرى.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center text-xs text-slate-500 font-medium animate-pulse">
          ⏳ جاري التحقق من رابط الدعوة وصلاحيته...
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-2xl">
            ❌
          </div>
          <h2 className="text-lg font-black text-slate-900 mb-2">رابط الدعوة غير متاح</h2>
          <p className="text-xs text-rose-700 mb-6 leading-relaxed">{error}</p>
          <Link
            href="/login"
            className="inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800"
          >
            الانتقال لصفحة تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-2xl">
            ✨
          </div>
          <span className="inline-block rounded-full bg-rose-100 px-3 py-1 text-[11px] font-bold text-rose-800 mb-2">
            دعوة انضمام شريك جديد
          </span>
          <h1 className="text-xl font-black text-slate-900">مرحباً بك في My CRM Salon</h1>
          <p className="mt-1 text-xs text-slate-500">
            تم تجهيز حساب مركز <span className="font-bold text-slate-800">{inviteData?.salonName}</span> بنجاح.
          </p>
        </div>

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-900">
            <span className="text-3xl mb-2 block">🎉</span>
            <h3 className="font-black text-sm">تم إعداد كلمة المرور وتفعيل الحساب!</h3>
            <p className="text-xs text-emerald-700 mt-1">جاري توجيهك إلى لوحة تحكم صالونك الآن...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني المعتمد</label>
              <input
                type="email"
                disabled
                value={inviteData?.email || ''}
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs text-slate-600 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                تعيين كلمة المرور الجديدة <span className="text-rose-600">*</span>
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة مرور قوية (8 خانات على الأقل)"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:border-rose-600 focus:outline-none focus:ring-1 focus:ring-rose-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                تأكيد كلمة المرور <span className="text-rose-600">*</span>
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="أعد إدخال كلمة المرور"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:border-rose-600 focus:outline-none focus:ring-1 focus:ring-rose-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-l from-rose-900 to-rose-700 py-3 text-xs font-black text-white shadow-md hover:from-rose-800 hover:to-rose-600 disabled:opacity-50"
            >
              {submitting ? 'جاري تفعيل الحساب وحفظ كلمة المرور...' : 'تفعيل الحساب والدخول للصالون ✨'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-xs text-slate-400">
          جاري التحميل...
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
