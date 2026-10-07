import { useCallback } from 'react';
import { router, Tabs } from 'expo-router';
import { RoleGate } from '@/components/RoleGate';
import { tabIcon, tabScreenOptions } from '@/components/tab-options';
import { openBooking } from '@/features/bookings/nav';
import { PushRegistration, type PushData } from '@/features/notifications/components/PushRegistration';
import { t } from '@/strings/en';

/** Owner tab bar: Today · Calendar · Bookings · Setup · Reports */
export default function OwnerLayout() {
  // Tapped push: the booking it's about, else the D6 list.
  const onPush = useCallback((data: PushData) => {
    if (typeof data.bookingId === 'number') openBooking('today', data.bookingId);
    else router.push('/today/notifications');
  }, []);
  return (
    <RoleGate role="owner">
      <PushRegistration onOpen={onPush} />
      <Tabs screenOptions={tabScreenOptions}>
        <Tabs.Screen name="today" options={{ title: t.tabs.today, tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="calendar" options={{ title: t.tabs.calendar, tabBarIcon: tabIcon('calendar') }} />
        <Tabs.Screen name="bookings" options={{ title: t.tabs.bookings, tabBarIcon: tabIcon('list') }} />
        <Tabs.Screen name="setup" options={{ title: t.tabs.setup, tabBarIcon: tabIcon('settings') }} />
        <Tabs.Screen name="reports" options={{ title: t.tabs.reports, tabBarIcon: tabIcon('chart') }} />
      </Tabs>
    </RoleGate>
  );
}
