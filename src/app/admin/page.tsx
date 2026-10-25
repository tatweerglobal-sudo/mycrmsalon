import { requireServerSession } from '@/lib/auth/server-session';
import { redirect } from 'next/navigation';
import PlatformAdminView from '@/components/crm/platform-admin-view';

export const dynamic = process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'auto' : 'force-dynamic';

export default async function AdminPage() {
  const session = await requireServerSession();

  if (!session.isSuperAdmin) {
    redirect('/');
  }

  return <PlatformAdminView />;
}
