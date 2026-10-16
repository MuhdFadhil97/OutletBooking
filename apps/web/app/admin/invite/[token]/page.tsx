import { AdminInvite } from '@/components/admin/AdminInvite';
import { Logo } from '@/components/Logo';
import { s } from '@/strings/en';

/** I10 · Invite link: the new admin sets a name and password, then signs in (I5 → I6). */
export default async function AdminInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <header className="admin-top">
        <Logo />
        <span className="muted small">{s.admin.tagline}</span>
      </header>
      <main className="admin-center">
        <AdminInvite token={token} />
      </main>
    </>
  );
}
