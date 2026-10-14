'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminMe } from '@outletbooking/shared';
import { getAdminMe, signOut } from '@/lib/admin-auth';
import { s } from '@/strings/en';

type State = { kind: 'loading' } | { kind: 'ok'; admin: AdminMe } | { kind: 'error' };

const t = s.admin;

/** Signed-in check for /admin: anyone without a two-step admin session goes to /admin/login. */
export function AdminHome() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void getAdminMe().then((me) => {
      if (!live) return;
      if (me.kind === 'ok') setState({ kind: 'ok', admin: me.admin });
      else if (me.kind === 'error') setState({ kind: 'error' });
      else router.replace('/admin/login');
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (state.kind === 'loading') return <p className="admin-center muted">{t.loading}</p>;
  if (state.kind === 'error') {
    return (
      <div className="admin-center">
        <p className="alert alert-error" role="alert">
          {t.signIn.error}
        </p>
      </div>
    );
  }

  const { admin } = state;
  return (
    <div className="admin-center">
      <div className="card admin-card">
        <h1>{t.home.title}</h1>
        <p>
          {t.home.signedInAs} <strong>{admin.name}</strong> ({admin.email}) · {t.home.roles[admin.role]}
        </p>
        <p className="muted">{t.home.next}</p>
        <button
          type="button"
          className="btn2"
          onClick={async () => {
            await signOut();
            router.replace('/admin/login');
          }}
        >
          {t.home.signOut}
        </button>
      </div>
    </div>
  );
}
