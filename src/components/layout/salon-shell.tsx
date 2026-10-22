'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavLink from './nav-link';
import { salonSections } from '@/lib/salon-sections';

export default function SalonShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);

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
          <p className="mt-1 text-xs text-slate-500">إدارة مراكز التجميل — نسخة التطوير</p>
        </div>
        <nav className="p-3" aria-label="القائمة الرئيسية">
          <NavLink href="/" label="لوحة التحكم" icon={<span>🏠</span>} />
          {salonSections.map(item => (
            <NavLink key={item.slug} href={'/' + item.slug} label={item.label} icon={<span>{item.icon}</span>} />
          ))}
        </nav>
        <div className="m-4 rounded-xl bg-rose-50 p-3 text-xs leading-6 text-rose-900">
          بيئة تأسيسية فقط. لم يتم ربط قاعدة بيانات أو تفعيل تسجيل الدخول.
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
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">
            قيد التطوير
          </span>
        </header>
        <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      <nav aria-label="التنقل السريع للهاتف" className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 p-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-xl lg:hidden">
        {[
          { href: '/', label: 'الرئيسية', icon: '🏠' },
          { href: '/customers', label: 'العملاء', icon: '👥' },
          { href: '/appointments', label: 'الحجوزات', icon: '📅' },
          { href: '/services', label: 'الخدمات', icon: '✨' },
        ].map(item => {
          const cleanPath = pathname === '/' ? '/' : (pathname?.replace(/\/$/, '') || '/');
          const cleanHref = item.href === '/' ? '/' : item.href.replace(/\/$/, '');
          const isCurrent = cleanPath === cleanHref;
          return (
            <Link
              key={item.href}
              href={item.href}
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
