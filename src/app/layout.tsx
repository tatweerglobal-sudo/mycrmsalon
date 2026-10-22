import type { Metadata } from 'next';
import SalonShell from '@/components/layout/salon-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'My CRM Salon | إدارة مراكز التجميل',
  description: 'منصة SaaS لإدارة مراكز التجميل غير الطبية',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <SalonShell>{children}</SalonShell>
      </body>
    </html>
  );
}
