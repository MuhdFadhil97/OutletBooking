import type { AppNotification } from '@outletbooking/shared';
import { router } from 'expo-router';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { openBooking } from '@/features/bookings/nav';
import { useMe } from '@/features/me/hooks';
import { NotificationsScreen } from '@/features/notifications/components/NotificationsScreen';

/** D6 · owner notifications (from the Today bell). */
export default function OwnerNotificationsScreen() {
  const { me, isLoading, error, refetch } = useMe();
  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const onOpen = (n: AppNotification) => {
    if (n.bookingId) openBooking('today', n.bookingId);
    else if (n.type === 'staff_joined') router.push('/setup/staff');
  };
  return <NotificationsScreen timezone={me.business.timezone} onOpen={onOpen} />;
}
