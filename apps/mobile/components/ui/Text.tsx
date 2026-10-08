import { Text as RNText, type TextProps } from 'react-native';

/** A text-colour class (text-danger, text-[#fff]) — not size or alignment (text-[14px], text-center, text-xl). */
const COLOR_CLASS = /(^|\s)text-(\[#|(?!(left|center|right|justify|xs|sm|base|lg|xl|\dxl)(\s|$))[a-z])/;

/**
 * App text: Manrope + body colour by default. Use font-bold / font-extrabold
 * classes for weight (custom fonts need one family per weight). The default colour is
 * left out when a colour class is given: generated CSS order would otherwise decide which wins.
 */
export function Text({ className, ...props }: TextProps & { className?: string }) {
  const cls = className ?? '';
  return <RNText className={`font-sans ${COLOR_CLASS.test(cls) ? '' : 'text-text '}${cls}`} {...props} />;
}
