'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** I6: the authenticator secret as a QR code, drawn in the browser (the secret never leaves the page). */
export function SetupQr({ uri, alt }: { uri: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { width: 200, margin: 1, color: { dark: '#16211C', light: '#FFFFFF' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);

  return (
    <div className="setup-qr">
      {src ? <img src={src} alt={alt} width={200} height={200} /> : <div className="setup-qr-empty" aria-hidden="true" />}
    </div>
  );
}
