import { AdminSignIn } from '@/components/admin/AdminSignIn';
import { Logo } from '@/components/Logo';
import { s } from '@/strings/en';

/** I5 · Admin sign in → I6 · two-step code */
export default function AdminLoginPage() {
  return (
    <>
      <header className="admin-top">
        <Logo />
        <span className="muted small">{s.admin.tagline}</span>
      </header>
      <main className="admin-center">
        <AdminSignIn />
      </main>
    </>
  );
}
