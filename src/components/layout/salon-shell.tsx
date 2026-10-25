'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavLink from './nav-link';
import { salonSections } from '@/lib/salon-sections';

interface AuthProfile {
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
  };
  activeTenant: {
    id: string;
    role: string;
    branchId: string | null;
  } | null;
}

export default function SalonShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const pathname = usePathname();

  // تفعيل وسيط Fetch العالمي لضمان إرفاق توكن المصادقة تلقائياً لكافة طلبات الـ API
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // مزامنة التوكن إذا كان موجوداً في معلمات الرابط st
      const searchParams = new URLSearchParams(window.location.search);
      const urlToken = searchParams.get('st');
      if (urlToken) {
        try {
          localStorage.setItem('salon_token', urlToken);
          sessionStorage.setItem('salon_token', urlToken);
        } catch (_e) {}
      }

      const originalFetch = window.fetch;
      window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('/api/') || url.includes('/api/')) {
          let token: string | null = null;
          try {
            token = localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
          } catch (_e) {}

          if (token) {
            init = init || {};
            const headers = new Headers(init.headers || {});
            if (!headers.has('Authorization')) {
              headers.set('Authorization', `Bearer ${token}`);
            }
            init.headers = headers;
          }
        }
        return originalFetch(input, init);
      };
    }
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  const checkAuth = async () => {
    try {
      let token: string | null = null;
      if (typeof window !== 'undefined') {
        const searchParams = new URLSearchParams(window.location.search);
        token = searchParams.get('st') || localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
      }

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/auth/me', { headers });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      } else {
        setProfile(null);
      }
    } catch (_err) {
      setProfile(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  const handleLogout = async () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('salon_token');
        sessionStorage.removeItem('salon_token');
      }
      await fetch('/api/auth/logout', { method: 'POST' });
      setProfile(null);
      window.location.href = '/login';
    } catch (_err) {
      // ignore
    }
  };

  const roleLabel = (role?: string) => {
    switch (role) {
      case 'salon_owner':
        return 'مالكة الصالون (مدير عام)';
      case 'salon_manager':
        return 'مديرة الفرع';
      case 'receptionist':
        return 'موظفة استقبال';
      case 'beauty_specialist':
        return 'أخصائية تجميل';
      default:
        return 'مستخدم معتمد';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {menuOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={
        'fixed top-0 right-0 z-50 h-dvh w-64 overflow-y-auto bg-white border-l border-slate-200 shadow-lg transition-transform lg:translate-x-0 ' +
        (menuOpen ? 'translate-x-0' : 'translate-x-full')
      }>
        <div className="p-5 border-b border-rose-100">
          <Link href="/" className="text-xl font-black text-rose-800">My CRM Salon</Link>
          <p className="mt-1 text-xs text-slate-500">نظام إدارة صالونات ومراكز التجميل</p>
        </div>
        <nav className="p-3 space-y-1" aria-label="القائمة الرئيسية">
          {profile?.user?.isSuperAdmin && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-2 shadow-sm">
              <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-black text-amber-900">
                <span className="flex items-center gap-1">👑 لوحة مالك المنصة</span>
                <span className="rounded bg-amber-200/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">Super Admin</span>
              </div>
              <NavLink href="/admin" label="إدارة المراكز والاشتراكات" icon={<span>🏢</span>} />
            </div>
          )}
          <NavLink href="/" label="لوحة التحكم" icon={<span>🏠</span>} />
          {salonSections.map(item => (
            <NavLink key={item.slug} href={'/' + item.slug} label={item.label} icon={<span>{item.icon}</span>} />
          ))}
        </nav>

        <div className="m-4 rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-xs leading-6 text-rose-950">
          {profile ? (
            <div>
              <p className="font-bold text-rose-900">✨ الجلسة نشطة ومؤمنة</p>
              <p className="mt-1 font-medium text-slate-700">{profile.user.name}</p>
              <p className="text-[11px] text-slate-500">{roleLabel(profile.activeTenant?.role)}</p>
            </div>
          ) : (
            <div>
              <p className="font-bold text-rose-900">🔒 نظام تشغيل الإنتاج</p>
              <p className="mt-1 text-slate-600">يرجى تسجيل الدخول للوصول إلى بيانات المركز والحجوزات.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0 lg:mr-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="فتح القائمة"
              aria-expanded={menuOpen}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xl lg:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
            >☰</button>
            <Link href="/" className="text-lg font-black text-rose-800 lg:hidden">My CRM Salon</Link>
            <span className="hidden text-sm font-bold text-slate-800 lg:inline">نظام إدارة مراكز التجميل</span>
          </div>

          <div className="flex items-center gap-3">
            {profile?.user?.isSuperAdmin && (
              <Link
                href={(() => {
                  let h = '/admin';
                  if (typeof window !== 'undefined') {
                    const token = localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
                    if (token) h += `?st=${encodeURIComponent(token)}`;
                  }
                  return h;
                })()}
                className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/80 px-3 py-1.5 text-xs font-black text-amber-950 shadow-sm transition hover:bg-amber-200"
              >
                <span>👑</span>
                <span className="hidden sm:inline">لوحة المنصة (Super Admin)</span>
                <span className="sm:hidden">المنصة</span>
              </Link>
            )}
            {!authLoading && profile ? (
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="hidden text-left text-xs leading-tight sm:block">
                  <p className="font-bold text-slate-900">{profile.user.name}</p>
                  <p className="text-[11px] text-slate-500">{roleLabel(profile.activeTenant?.role)}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 shadow-sm transition hover:bg-rose-100"
                >
                  تسجيل الخروج
                </button>
              </div>
            ) : !authLoading ? (
              <Link
                href="/login"
                className="rounded-xl bg-rose-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-800"
              >
                تسجيل الدخول
              </Link>
            ) : null}
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      <nav aria-label="التنقل السريع للهاتف" className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 p-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-xl lg:hidden">
        {[
          { href: '/', label: 'الرئيسية', icon: '🏠' },
          { href: '/customers', label: 'العملاء', icon: '👥' },
          { href: '/appointments', label: 'الحجوزات', icon: '📅' },
          { href: '/financials', label: 'المالية', icon: '💳' },
          { href: '/services', label: 'الخدمات', icon: '✨' },
        ].map(item => {
          const cleanPath = pathname === '/' ? '/' : (pathname?.replace(/\/$/, '') || '/');
          const cleanHref = item.href === '/' ? '/' : item.href.replace(/\/$/, '');
          const isCurrent = cleanPath === cleanHref;
          let targetHref = item.href;
          if (typeof window !== 'undefined') {
            try {
              const token = localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
              if (token) {
                targetHref = item.href + (item.href.includes('?') ? '&' : '?') + 'st=' + encodeURIComponent(token);
              }
            } catch (_e) {}
          }
          return (
            <Link
              key={item.href}
              href={targetHref}
              className={'flex min-h-12 flex-col items-center justify-center rounded-lg text-xs ' +
                (isCurrent ? 'bg-rose-50 font-black text-rose-800' : 'text-slate-500')}
            >
              <span className="text-lg">{item.icon}</span><span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
