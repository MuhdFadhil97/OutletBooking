import { Text as RNText, type TextProps } from 'react-native';

/**
 * App text: Manrope + body colour by default. Use font-bold / font-extrabold
 * classes for weight (custom fonts need one family per weight).
 */
export function Text({ className, ...props }: TextProps & { className?: string }) {
  return <RNText className={`font-sans text-text ${className ?? ''}`} {...props} />;
}
