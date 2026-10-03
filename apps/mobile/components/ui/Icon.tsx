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
  'chevron-right': <Path d="m9 6 6 6-6 6" />,
  'chevron-left': <Path d="m15 6-6 6 6 6" />,
  'chevron-up': <Path d="m6 15 6-6 6 6" />,
  'chevron-down': <Path d="m6 9 6 6 6-6" />,
  trash: <Path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />,
  copy: (
    <>
      <Rect x={9} y={9} width={12} height={12} rx={2} />
      <Path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  users: (
    <>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  form: <Path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 8h8M8 12h8M8 16h5" />,
  tag: (
    <>
      <Path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <Circle cx={8} cy={8} r={1.5} />
    </>
  ),
  pause: <Path d="M8 5v14M16 5v14" />,
  mail: (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="m3 7 9 6 9-6" />
    </>
  ),
  phone: <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  chat: <Path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" />,
  search: (
    <>
      <Circle cx={11} cy={11} r={6.5} />
      <Path d="M16 16l4.5 4.5" />
    </>
  ),
  pin: (
    <>
      <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <Circle cx={12} cy={10} r={2.5} />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}
