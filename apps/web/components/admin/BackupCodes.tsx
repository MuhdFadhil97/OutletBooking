'use client';

import { useState } from 'react';
import { s } from '@/strings/en';

const t = s.admin;

/** The 10 one-time backup codes, with a copy button (I6 setup, I29 new codes and new phone). */
export function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="backup-codes">
      <ul>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn2 btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true));
        }}
      >
        {copied ? t.setup.copied : t.setup.copy}
      </button>
    </div>
  );
}
