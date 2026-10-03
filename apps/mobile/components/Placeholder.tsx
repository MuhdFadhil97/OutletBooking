import { Card } from './ui/Card';
import { EmptyState } from './ui/ScreenState';
import { Icon, type IconName } from './ui/Icon';
import { Screen, ScreenTitle } from './Screen';
import { t } from '@/strings/en';
import { colors } from '@/theme';

/** Tab that is built in a later phase. */
export function PlaceholderScreen({ title, body, icon }: { title: string; body: string; icon: IconName }) {
  return (
    <Screen>
      <ScreenTitle title={title} />
      <Card>
        <EmptyState icon={<Icon name={icon} size={32} color={colors.muted} />} title={t.common.comingSoon} body={body} />
      </Card>
    </Screen>
  );
}
