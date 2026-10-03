import { View } from 'react-native';
import { router } from 'expo-router';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { serviceSummary } from '@/features/setup/format';
import { useServices } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.setup.services;

export default function ServicesScreen() {
  const services = useServices();
  const add = () => router.push({ pathname: '/setup/services/[id]', params: { id: 'new' } });

  if (services.isPending) return <LoadingState />;
  if (services.error) return <ErrorState error={services.error} onRetry={() => void services.refetch()} />;

  return (
    <StackScreen title={s.title} right={<HeaderIconButton icon="plus" label={s.add} onPress={add} />}>
      {services.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="tag" size={32} color={colors.muted} />}
            title={s.empty}
            body={s.emptyBody}
            action={<Button title={s.add} onPress={add} className="mt-2 w-48" />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {services.data.map((svc, i) => (
            <ListRow
              key={svc.id}
              title={svc.name}
              subtitle={serviceSummary(svc)}
              right={!svc.isVisible ? <Tag label={t.setup.hidden} /> : <View />}
              onPress={() => router.push({ pathname: '/setup/services/[id]', params: { id: String(svc.id) } })}
              last={i === services.data.length - 1}
            />
          ))}
        </Card>
      )}
    </StackScreen>
  );
}
