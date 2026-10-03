import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import type { Tabs } from 'expo-router';
import { colors, fonts } from '@/theme';
import { Icon, type IconName } from './ui/Icon';

/** Wireframe tab bar: 72px, white, top border, 11px bold labels, green when active. */
type TabOptions = Exclude<ComponentProps<typeof Tabs>['screenOptions'], ((...args: never[]) => unknown) | undefined>;

export const tabScreenOptions: TabOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.muted,
  tabBarStyle: { height: 72, paddingBottom: 10, paddingTop: 8, borderTopColor: colors.border, backgroundColor: colors.card },
  tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
  sceneStyle: { backgroundColor: colors.bg },
};

export const tabIcon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Icon name={name} color={String(color)} />;
