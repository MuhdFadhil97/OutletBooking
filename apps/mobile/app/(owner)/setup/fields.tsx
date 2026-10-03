import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { useBookingFields, useReorderBookingFields, useServices } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const f = t.setup.fields;

/** FR-14 · Custom booking form questions, in the order customers see them. */
export default function FieldsScreen() {
  const fields = useBookingFields();
  const services = useServices();
  const reorder = useReorderBookingFields();
  const add = () => router.push({ pathname: '/setup/fields/[id]', params: { id: 'new' } });

  if (!fields.data || !services.data) {
    const error = fields.error ?? services.error;
    return error ? <ErrorState error={error} onRetry={() => void fields.refetch()} /> : <LoadingState />;
  }

  const serviceName = new Map(services.data.map((s) => [s.id, s.name]));
  const list = fields.data;

  const move = (index: number, dir: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <StackScreen title={f.title} right={<HeaderIconButton icon="plus" label={f.newTitle} onPress={add} />}>
      <Text className="text-[13px] text-muted">{f.intro}</Text>
      <FormError message={reorder.error ? errorMessage(reorder.error) : null} />
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="form" size={32} color={colors.muted} />}
            title={f.empty}
            body={f.emptyBody}
            action={<Button title={f.newTitle} onPress={add} className="mt-2 w-48" />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {list.map((field, i) => (
            <View
              key={field.id}
              className={`flex-row items-center ${i < list.length - 1 ? 'border-b border-border' : ''} ${field.isActive ? '' : 'opacity-60'}`}
            >
              <Pressable
                onPress={() => router.push({ pathname: '/setup/fields/[id]', params: { id: String(field.id) } })}
                accessibilityRole="button"
                className="min-h-[60px] flex-1 justify-center gap-1 py-2.5 pl-3.5 active:bg-pressed"
              >
                <Text className="text-[15px] font-bold">{field.label}</Text>
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Text className="text-[12px] text-muted">
                    {f.types[field.fieldType]} · {field.serviceId ? serviceName.get(field.serviceId) : f.allServices}
                  </Text>
                  {field.isRequired ? <Tag label={f.requiredTag} tone="info" /> : null}
                  {!field.isActive ? <Tag label={t.setup.hidden} /> : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => move(i, -1)}
                disabled={i === 0 || reorder.isPending}
                accessibilityRole="button"
                accessibilityLabel={`${f.moveUp}: ${field.label}`}
                className={`h-11 w-10 items-center justify-center ${i === 0 ? 'opacity-30' : ''}`}
              >
                <Icon name="chevron-up" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                onPress={() => move(i, 1)}
                disabled={i === list.length - 1 || reorder.isPending}
                accessibilityRole="button"
                accessibilityLabel={`${f.moveDown}: ${field.label}`}
                className={`mr-1 h-11 w-10 items-center justify-center ${i === list.length - 1 ? 'opacity-30' : ''}`}
              >
                <Icon name="chevron-down" size={20} color={colors.text} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </StackScreen>
  );
}
