import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import { colors } from '@/theme';
import { Text } from './Text';

interface Props extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  className?: string;
}

/** Primary: 52px green; secondary: 50px outlined (wireframe .btn / .btn2); danger: 52px red for irreversible actions. */
export function Button({ title, variant = 'primary', loading, disabled, className, ...props }: Props) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const filled = isPrimary || isDanger;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      className={`flex-row items-center justify-center rounded-button ${
        isPrimary
          ? 'h-[52px] bg-primary active:bg-primary-pressed'
          : isDanger
            ? 'h-[52px] bg-danger active:opacity-80'
            : 'h-[50px] border border-input-border bg-card active:bg-pressed'
      } ${isDisabled ? 'opacity-60' : ''} ${className ?? ''}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={filled ? '#FFFFFF' : colors.primary} />
      ) : (
        <Text className={`font-bold ${filled ? 'text-[16px] text-white' : 'text-[15px] text-text'}`}>{title}</Text>
      )}
    </Pressable>
  );
}
