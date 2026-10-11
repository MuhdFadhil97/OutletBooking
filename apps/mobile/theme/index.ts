// Typed access to the design tokens (for places that need raw values: icons, tab bar, status bar).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tokens = require('./tokens.js') as {
  colors: Record<
    | 'primary' | 'primary-pressed' | 'primary-tint' | 'primary-light' | 'soft' | 'bg' | 'card' | 'border' | 'input-border'
    | 'pressed' | 'text' | 'muted' | 'label' | 'danger' | 'danger-tint'
    | 'ok-bg' | 'ok-fg' | 'pend-bg' | 'pend-fg' | 'neutral-bg' | 'neutral-fg' | 'info-bg' | 'info-fg',
    string
  >;
  radius: { card: number; button: number; input: number };
  sizes: { button: number; input: number; inputCompact: number; touch: number };
};

export const colors = tokens.colors;
export const radius = tokens.radius;
export const sizes = tokens.sizes;

export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
} as const;
