import { useMemo } from 'react';
import QRCode from 'qrcode';
import Svg, { Path, Rect } from 'react-native-svg';

const QUIET = 4; // modules of white border scanners need

/** QR code as SVG (works on Android, iOS and web). */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { path, count } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) {
        if (modules.get(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }
    }
    return { path: d, count: modules.size + QUIET * 2 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} accessibilityLabel={label}>
      <Rect width={count} height={count} fill="#FFFFFF" />
      <Path d={path} fill="#16211C" />
    </Svg>
  );
}
