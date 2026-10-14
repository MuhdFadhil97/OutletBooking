import { AdminSignIn } from '@/components/admin/AdminSignIn';

/** I5 · Admin sign in → I6 · two-step code */
export default function AdminLoginPage() {
  return (
    <div className="admin-center">
      <AdminSignIn />
    </div>
  );
}
