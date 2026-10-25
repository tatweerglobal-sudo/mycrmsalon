import { requireServerSession } from '@/lib/auth/server-session';
import DashboardHome from '@/components/crm/dashboard-home';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export default async function HomePage() {
  await requireServerSession();

  return <DashboardHome />;
}
