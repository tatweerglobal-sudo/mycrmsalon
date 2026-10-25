'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'فشل تسجيل الدخول. يرجى التحقق من البيانات.');
      }

      // توجيه المستخدم إلى لوحة التحكم الرئيسية بعد تسجيل الدخول بنجاح
      window.location.href = '/';
    } catch (err: unknown) {
      setError((err as Error).message || 'حدث خطأ غير متوقع أثناء الاتصال بالخادم.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12" dir="rtl">
      <div className="w-full max-w-md space-y-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-xl sm:p-10">
        <div className="text-center">
          <Link href="/" className="inline-block text-2xl font-black text-rose-800">
            My CRM Salon
          </Link>
          <h2 className="mt-4 text-xl font-black text-slate-900">تسجيل الدخول إلى المركز</h2>
          <p className="mt-2 text-xs text-slate-500">
            أدخل البريد الإلكتروني وكلمة المرور للوصول إلى إدارة صالونك
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium leading-6 text-rose-900"
          >
            ⚠️ {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-bold text-slate-700">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@crmsalon.de"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-rose-600 focus:outline-none focus:ring-1 focus:ring-rose-600"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-700">
                كلمة المرور
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-rose-600 focus:outline-none focus:ring-1 focus:ring-rose-600"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'جاري التحقق والمصادقة...' : 'تسجيل الدخول'}
            </button>
          </div>

          <div className="text-center">
            <Link href="/" className="text-xs font-bold text-slate-500 hover:text-rose-700">
              ← العودة إلى الصفحة الرئيسية
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
