import { AccountCard } from '@/components/AccountCard';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/ScreenState';
import { Icon } from '@/components/ui/Icon';
import { Screen, ScreenTitle } from '@/components/Screen';
import { t } from '@/strings/en';
import { colors } from '@/theme';

export default function SetupScreen() {
  return (
    <Screen>
      <ScreenTitle title={t.tabs.setup} />
      <Card>
        <EmptyState icon={<Icon name="settings" size={32} color={colors.muted} />} title={t.common.comingSoon} body={t.placeholder.setup} />
      </Card>
      <AccountCard />
    </Screen>
  );
}
