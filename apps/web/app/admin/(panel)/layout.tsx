import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';

/** Signed-in admin pages: sidebar + the admin's session check. */
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
