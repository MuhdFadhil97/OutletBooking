import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import QRCode from 'qrcode';

/** QR code drawn with react-native-svg (works on Android, iOS and web; no image files). */
export function QrCode({ value, size = 200, color = '#16211C' }: { value: string; size?: number; color?: string }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 2; // white border so scanners find the edges
  const box = count + quiet * 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} accessibilityLabel={value}>
      <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#FFFFFF" />
      <Path d={path} fill={color} />
    </Svg>
  );
}
