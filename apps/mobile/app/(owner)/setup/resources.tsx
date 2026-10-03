import { View } from 'react-native';
import { router } from 'expo-router';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { useBusiness, useResources, useServices } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const r = t.setup.resources;

/** O6 · list of courts / bays / agents. Tap one to edit it and its working hours. */
export default function ResourcesScreen() {
  const resources = useResources();
  const services = useServices();
  const business = useBusiness();
  const label = business.data?.resourceLabel ?? 'Resource';
  const add = () => router.push({ pathname: '/setup/resources/[id]', params: { id: 'new' } });

  if (!resources.data || !services.data) {
    const error = resources.error ?? services.error;
    return error ? <ErrorState error={error} onRetry={() => void resources.refetch()} /> : <LoadingState />;
  }

  const serviceName = new Map((services.data ?? []).map((s) => [s.id, s.name]));

  return (
    <StackScreen
      title={r.title(label)}
      subtitle={r.labelNote}
      right={<HeaderIconButton icon="plus" label={r.add(label)} onPress={add} />}
    >
      {resources.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="calendar" size={32} color={colors.muted} />}
            title={r.empty(label)}
            body={r.emptyBody}
            action={<Button title={r.add(label)} onPress={add} className="mt-2 w-48" />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {resources.data.map((res, i) => {
            const names = res.serviceIds.map((id) => serviceName.get(id)).filter(Boolean);
            return (
              <ListRow
                key={res.id}
                title={res.name}
                subtitle={[names.join(', ') || r.types[res.resourceType], res.linkedUser?.name].filter(Boolean).join(' · ')}
                left={<View className="h-3 w-3 rounded-full" style={{ backgroundColor: res.color ?? colors.primary }} />}
                right={!res.isActive ? <Tag label={t.setup.inactive} /> : undefined}
                onPress={() => router.push({ pathname: '/setup/resources/[id]', params: { id: String(res.id) } })}
                last={i === resources.data.length - 1}
              />
            );
          })}
        </Card>
      )}
    </StackScreen>
  );
}
