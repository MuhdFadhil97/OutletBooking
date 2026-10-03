import { AccountCard } from '@/components/AccountCard';
import { Screen, ScreenTitle } from '@/components/Screen';
import { t } from '@/strings/en';

export default function StaffProfileScreen() {
  return (
    <Screen>
      <ScreenTitle title={t.tabs.profile} />
      <AccountCard />
    </Screen>
  );
}
