import { Tabs } from 'expo-router';
import { RoleGate } from '@/components/RoleGate';
import { tabIcon, tabScreenOptions } from '@/components/tab-options';
import { PushSetup } from '@/features/push/PushSetup';
import { t } from '@/strings/en';

/** Owner tab bar: Today · Calendar · Bookings · Setup · Reports */
export default function OwnerLayout() {
  return (
    <RoleGate role="owner">
      <PushSetup role="owner" />
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
