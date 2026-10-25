'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export default function NavLink({ href, label, icon, badge, disabled }: NavLinkProps) {
  const pathname = usePathname() || '/';
  const cleanPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  const cleanHref = href === '/' ? '/' : href.replace(/\/$/, '');
  const isActive = cleanPath === cleanHref || (cleanHref !== '/' && cleanPath.startsWith(cleanHref));

  if (disabled) {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-lg text-slate-400 bg-slate-100 cursor-not-allowed opacity-75 select-none my-1">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5">{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-bold">معطل قريباً</span>
      </div>
    );
  }

  let targetHref = href;
  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('salon_token') || sessionStorage.getItem('salon_token');
      if (token) {
        targetHref = href + (href.includes('?') ? '&' : '?') + 'st=' + encodeURIComponent(token);
      }
    } catch (_e) {}
  }

  return (
    <Link
      href={targetHref}
      className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors my-1 ${
        isActive
          ? 'bg-rose-700 text-white font-bold shadow-sm'
          : 'text-slate-700 hover:bg-slate-100 hover:text-rose-700'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      {badge && (
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isActive ? 'bg-rose-800 text-white' : 'bg-rose-100 text-rose-800'
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
