// Single source of design tokens — used by tailwind.config.js (NativeWind) and by TS code via theme/index.ts.
// CommonJS so Tailwind can require it.
/** @type {const} */
const colors = {
  primary: '#0F7B55',
  'primary-pressed': '#0A5C40',
  'primary-tint': '#DDF3E8',
  soft: '#F0F7F3',
  bg: '#F6F7F5',
  card: '#FFFFFF',
  border: '#E1E6E2',
  'input-border': '#CBD3CE',
  pressed: '#F0F3F1',
  text: '#16211C',
  muted: '#56625B',
  label: '#33403A',
  danger: '#B42318',
  'danger-tint': '#FDE8E7',
  'ok-bg': '#DDF3E8',
  'ok-fg': '#0B5E40',
  'pend-bg': '#FDEBD3',
  'pend-fg': '#8A4A06',
  'neutral-bg': '#E9ECEA',
  'neutral-fg': '#46524B',
  'info-bg': '#E0ECFB',
  'info-fg': '#1D4F91',
};

const fontFamily = {
  sans: ['Manrope_400Regular'],
  medium: ['Manrope_500Medium'],
  semibold: ['Manrope_600SemiBold'],
  bold: ['Manrope_700Bold'],
  extrabold: ['Manrope_800ExtraBold'],
};

const radius = { card: 14, button: 12, input: 10 };
const sizes = { button: 52, input: 50, inputCompact: 46, touch: 44 };

module.exports = { colors, fontFamily, radius, sizes };
