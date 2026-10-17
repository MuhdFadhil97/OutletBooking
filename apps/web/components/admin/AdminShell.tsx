'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AdminMe } from '@outletbooking/shared';
import { Logo } from '@/components/Logo';
import { takeIdleExpired } from '@/lib/admin-api';
import { getAdminMe, signOut } from '@/lib/admin-auth';
import { s } from '@/strings/en';

const t = s.admin;

type NavKey = keyof typeof t.shell.nav;
/** Sidebar from Flow-6: every admin page. Pages not built yet are shown but not linked. */
/** `superOnly` pages are hidden from Support admins (the API refuses them too). */
const NAV: { group?: keyof typeof t.shell.groups; items: { key: NavKey; href?: string; superOnly?: boolean }[] }[] = [
  { items: [{ key: 'businesses', href: '/admin' }, { key: 'trials', href: '/admin/trials' }, { key: 'payments', href: '/admin/payments' }, { key: 'support', href: '/admin/support' }] },
  { group: 'privacy', items: [{ key: 'privacy', href: '/admin/privacy' }, { key: 'deletion' }, { key: 'audit', href: '/admin/audit' }] },
  { group: 'platform', items: [{ key: 'health' }, { key: 'announcements', href: '/admin/announcements', superOnly: true }, { key: 'users', href: '/admin/users', superOnly: true }, { key: 'plans', href: '/admin/plans', superOnly: true }] },
];

interface AdminContext {
  admin: AdminMe;
  /** Call when the API says the session is gone (401/403): back to sign-in. */
  signedOut: () => void;
}

const Ctx = createContext<AdminContext | null>(null);

export function useAdmin(): AdminContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdmin outside AdminShell');
  return ctx;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Admin panel frame: checks the two-step admin session, then shows the sidebar and the page. */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    void getAdminMe().then((me) => {
      if (me.kind === 'ok') setAdmin(me.admin);
      else if (me.kind === 'error') setFailed(true);
      else router.replace(takeIdleExpired() ? '/admin/login?expired=1' : '/admin/login');
    });
  }, [router]);

  useEffect(load, [load]);

  const signedOut = useCallback(() => router.replace(takeIdleExpired() ? '/admin/login?expired=1' : '/admin/login'), [router]);

  if (!admin) {
    return (
      <main className="admin-center">
        {failed ? (
          <div className="card admin-card">
            <p className="alert alert-error" role="alert">
              {t.loadError}
            </p>
            <button type="button" className="btn2" onClick={load}>
              {t.retry}
            </button>
          </div>
        ) : (
          <p className="muted">{t.loading}</p>
        )}
      </main>
    );
  }

  const active = (href: string) => (href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/businesses') : pathname.startsWith(href));

  return (
    <Ctx.Provider value={{ admin, signedOut }}>
      <div className="admin-panel">
        <aside className="admin-side">
          <div className="admin-side-brand">
            <Logo />
            <span className="muted small">{t.tagline}</span>
          </div>
          <nav aria-label={t.shell.menu} className="side">
            {NAV.map((section, i) => (
              <div key={i} className="side-group">
                {section.group && <div className="side-heading">{t.shell.groups[section.group]}</div>}
                {section.items
                  .filter((item) => !item.superOnly || admin.role === 'super_admin')
                  .map((item) =>
                  item.href ? (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={active(item.href) ? 'on' : undefined}
                      aria-current={active(item.href) ? 'page' : undefined}
                    >
                      {t.shell.nav[item.key]}
                    </Link>
                  ) : (
                    <span key={item.key} className="side-soon" aria-disabled="true">
                      {t.shell.nav[item.key]}
                      <span className="tag tag-gray">{t.shell.soon}</span>
                    </span>
                  ),
                )}
              </div>
            ))}
          </nav>
          <div className="admin-me">
            <span className="avatar" aria-hidden="true">
              {initials(admin.name)}
            </span>
            <Link
              href="/admin/account"
              className="admin-me-link"
              aria-current={pathname.startsWith('/admin/account') ? 'page' : undefined}
            >
              <div className="admin-me-name">{admin.name}</div>
              <div className="muted small">
                {t.roles[admin.role]} · {t.account.menuLink}
              </div>
            </Link>
            <button
              type="button"
              className="btn2 btn-sm"
              onClick={async () => {
                await signOut();
                router.replace('/admin/login');
              }}
            >
              {t.shell.signOut}
            </button>
          </div>
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
