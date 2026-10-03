import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Line icons in the wireframe style (stroke 1.8, round caps). */
const paths = {
  home: <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <Rect x={3} y={4.5} width={18} height={16.5} rx={2} />
      <Path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  list: <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  settings: (
    <>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  chart: <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  user: (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  walk: (
    <>
      <Circle cx={13} cy={4} r={2} />
      <Path d="m9 21 2-6 3 3v3M7 12l3-4h4l3 4M11 15l-1-7" />
    </>
  ),
  share: (
    <>
      <Circle cx={18} cy={5} r={3} />
      <Circle cx={6} cy={12} r={3} />
      <Circle cx={18} cy={19} r={3} />
      <Path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  clock: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  check: <Path d="m5 12 5 5L20 7" />,
  x: <Path d="M6 6l12 12M18 6 6 18" />,
  building: <Path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4" />,
  car: (
    <>
      <Path d="M5 17h14v-5l-2-5H7l-2 5zM3 12h18" />
      <Circle cx={7.5} cy={17} r={1.5} />
      <Circle cx={16.5} cy={17} r={1.5} />
    </>
  ),
  court: (
    <>
      <Rect x={3} y={4} width={18} height={16} rx={1.5} />
      <Path d="M12 4v16M3 12h18" />
    </>
  ),
  wrench: <Path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />,
  scissors: (
    <>
      <Circle cx={6} cy={6} r={3} />
      <Circle cx={6} cy={18} r={3} />
      <Path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>
  ),
  grid: <Path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}
