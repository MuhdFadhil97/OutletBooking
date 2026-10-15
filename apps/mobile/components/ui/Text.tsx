import { Text as RNText, type TextProps } from 'react-native';
import { colors } from '@/theme';

// A colour class like `text-primary` must replace the default `text-text`, not compete with it:
// with both set, whichever comes later in the generated CSS wins (primary loses to text).
const COLOR_CLASS = new RegExp(`(^| )text-(${[...Object.keys(colors), 'white', 'black'].join('|')})( |$)`);

/**
 * App text: Manrope + body colour by default. Use font-bold / font-extrabold
 * classes for weight (custom fonts need one family per weight).
 */
export function Text({ className = '', ...props }: TextProps & { className?: string }) {
  const color = COLOR_CLASS.test(className) ? '' : 'text-text ';
  return <RNText className={`font-sans ${color}${className}`} {...props} />;
}
