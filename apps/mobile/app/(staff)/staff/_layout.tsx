import { Tabs } from 'expo-router';
import { RoleGate } from '@/components/RoleGate';
import { tabIcon, tabScreenOptions } from '@/components/tab-options';
import { PushRegistration } from '@/features/notifications/components/PushRegistration';
import { t } from '@/strings/en';

const openApp = () => {};

/** Staff tab bar: Today · Schedule · Profile (URLs under /staff so they don't clash with owner tabs). */
export default function StaffLayout() {
  return (
    <RoleGate role="staff">
      {/* Staff booking screens come in Phase 6; a tapped push just opens the app for now. */}
      <PushRegistration onOpen={openApp} />
      <Tabs screenOptions={tabScreenOptions}>
        <Tabs.Screen name="today" options={{ title: t.tabs.today, tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="schedule" options={{ title: t.tabs.schedule, tabBarIcon: tabIcon('calendar') }} />
        <Tabs.Screen name="profile" options={{ title: t.tabs.profile, tabBarIcon: tabIcon('user') }} />
      </Tabs>
    </RoleGate>
  );
}
