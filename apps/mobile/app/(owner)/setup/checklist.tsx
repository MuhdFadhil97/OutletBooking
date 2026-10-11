import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { OVERALL_RESULTS, reportSettings, type Checklist, type ReportSettingKey } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { showToast } from '@/components/ui/Toast';
import { useChecklist, useLoadStandardChecklist, useSaveChecklist } from '@/features/inspections/hooks';
import { useBusiness, useUpdateBusiness } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.inspection;
const LABEL_TONE: Record<(typeof OVERALL_RESULTS)[number], TagTone> = { pass: 'ok', attention: 'pending', fail: 'danger' };

interface DraftItem {
  key: string;
  id?: number;
  label: string;
}
interface DraftSection {
  key: string;
  id?: number;
  name: string;
  items: DraftItem[];
}

let seq = 0;
const newKey = () => `n${++seq}`;
const toDraft = (c: Checklist): DraftSection[] =>
  c.sections.map((sec) => ({
    key: `s${sec.id}`,
    id: sec.id,
    name: sec.name,
    items: sec.items.map((i) => ({ key: `i${i.id}`, id: i.id, label: i.label })),
  }));

/** ST-VI-C · Checklist & report: sections with checks, result labels, report options. */
export default function ChecklistScreen() {
  const checklist = useChecklist();
  const business = useBusiness();
  if (!checklist.data || !business.data) {
    const error = checklist.error ?? business.error;
    return (
      <StackScreen title={s.title}>
        {error ? <ErrorState error={error} onRetry={() => void checklist.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }
  return <ChecklistForm key={JSON.stringify(checklist.data)} checklist={checklist.data} settings={business.data.settings} />;
}

function ChecklistForm({ checklist, settings }: { checklist: Checklist; settings: Record<string, unknown> }) {
  const save = useSaveChecklist();
  const standard = useLoadStandardChecklist();
  const updateBusiness = useUpdateBusiness();
  const [sections, setSections] = useState<DraftSection[]>(() => toDraft(checklist));
  const [error, setError] = useState<string | null>(null);
  const report = reportSettings(settings);
  const checks = sections.reduce((n, sec) => n + sec.items.length, 0);

  const patchSection = (key: string, fn: (sec: DraftSection) => DraftSection) =>
    setSections((all) => all.map((sec) => (sec.key === key ? fn(sec) : sec)));
  const moveUp = (index: number) =>
    setSections((all) => {
      const next = [...all];
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });

  const onSave = () => {
    const body = {
      sections: sections
        .map((sec) => ({
          id: sec.id,
          name: sec.name.trim(),
          items: sec.items.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() })),
        }))
        .filter((sec) => sec.name || sec.items.length),
    };
    if (body.sections.some((sec) => !sec.name)) return setError(`${s.sectionName}: ${t.common.required}`);
    setError(null);
    save.mutate(body, { onSuccess: () => showToast({ message: s.saved }) });
  };

  const toggleReport = (key: ReportSettingKey) => (value: boolean) => updateBusiness.mutate({ settings: { [key]: value } });

  const formError = error ?? (save.error ? errorMessage(save.error) : standard.error ? errorMessage(standard.error) : null);

  return (
    <StackScreen
      title={s.title}
      subtitle={s.checks(checks)}
      footer={sections.length ? <Button title={s.save} loading={save.isPending} onPress={onSave} /> : undefined}
    >
      <FormError message={formError} />

      <SectionLabel label={s.sections} />
      {sections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="list" size={28} color={colors.muted} />}
            title={s.emptyTitle}
            body={s.emptyBody}
            action={<Button title={s.useStandard} loading={standard.isPending} onPress={() => standard.mutate()} />}
          />
        </Card>
      ) : (
        sections.map((sec, index) => (
          <Card key={sec.key} className="gap-2 p-3.5">
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <TextField
                  compact
                  label={s.sectionName}
                  value={sec.name}
                  onChangeText={(name) => patchSection(sec.key, (x) => ({ ...x, name }))}
                  maxLength={80}
                />
              </View>
              {index > 0 ? (
                <IconButton icon="chevron-up" label={s.moveUp} onPress={() => moveUp(index)} />
              ) : null}
              <IconButton icon="trash" label={s.removeSection} onPress={() => setSections((all) => all.filter((x) => x.key !== sec.key))} />
            </View>
            {sec.items.map((item, j) => (
              <View key={item.key} className="flex-row items-center gap-2">
                <View className="flex-1">
                  <TextField
                    compact
                    label={s.checkPlaceholder(j + 1)}
                    value={item.label}
                    onChangeText={(label) =>
                      patchSection(sec.key, (x) => ({ ...x, items: x.items.map((i) => (i.key === item.key ? { ...i, label } : i)) }))
                    }
                    maxLength={120}
                  />
                </View>
                <IconButton
                  icon="x"
                  label={`${s.removeCheck} ${j + 1}`}
                  onPress={() => patchSection(sec.key, (x) => ({ ...x, items: x.items.filter((i) => i.key !== item.key) }))}
                />
              </View>
            ))}
            <Pressable
              onPress={() => patchSection(sec.key, (x) => ({ ...x, items: [...x.items, { key: newKey(), label: '' }] }))}
              accessibilityRole="button"
              className="min-h-[44px] justify-center"
            >
              <Text className="text-[14px] font-bold text-primary">{s.addCheck}</Text>
            </Pressable>
          </Card>
        ))
      )}
      {sections.length ? (
        <>
          <Button
            variant="secondary"
            title={s.addSection}
            onPress={() => setSections((all) => [...all, { key: newKey(), name: '', items: [{ key: newKey(), label: '' }] }])}
          />
          <Text className="text-[12px] text-muted">{s.removedNote}</Text>
        </>
      ) : null}

      <SectionLabel label={s.resultLabels} />
      <Card className="flex-row flex-wrap gap-2 p-3.5">
        {OVERALL_RESULTS.map((o) => (
          <Tag key={o} label={s.outcomes[o]} tone={LABEL_TONE[o]} />
        ))}
      </Card>

      <SectionLabel label={s.report} />
      <Card className="gap-1 px-3.5 py-2">
        <SwitchRow label={s.reportWhatsapp} hint={s.reportWhatsappHint} value={report.reportWhatsapp} onChange={toggleReport('reportWhatsapp')} disabled={updateBusiness.isPending} />
        <SwitchRow label={s.reportPhotos} hint={s.reportPhotosHint} value={report.reportPhotos} onChange={toggleReport('reportPhotos')} disabled={updateBusiness.isPending} />
        <SwitchRow
          label={s.reportInspector}
          hint={s.reportInspectorHint}
          value={report.reportInspectorName}
          onChange={toggleReport('reportInspectorName')}
          disabled={updateBusiness.isPending}
        />
      </Card>
      <FormError message={updateBusiness.error ? errorMessage(updateBusiness.error) : null} />
    </StackScreen>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'trash' | 'x' | 'chevron-up'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-button active:bg-pressed"
    >
      <Icon name={icon} size={18} color={colors.muted} />
    </Pressable>
  );
}
