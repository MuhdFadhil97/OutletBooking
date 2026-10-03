import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { format, parseISO } from 'date-fns';
import { staffInviteSchema, type Resource, type StaffInvitation, type StaffMember } from '@outletbooking/shared';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { ListRow, SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useBusiness, useResources } from '@/features/setup/hooks';
import { useInviteStaff, useRevokeInvitation, useStaff, useUpdateMember } from '@/features/staff/hooks';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.staff;

/** FR-05.1/05.3 · Team: invite staff by email (shareable link), link resources, remove access. */
export default function StaffScreen() {
  const staff = useStaff();
  const resources = useResources();
  const business = useBusiness();
  const revoke = useRevokeInvitation();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  if (!staff.data || !resources.data || !business.data) {
    const error = staff.error ?? resources.error ?? business.error;
    return error ? <ErrorState error={error} onRetry={() => void staff.refetch()} /> : <LoadingState />;
  }

  const label = business.data.resourceLabel;
  const resourceName = new Map(resources.data.map((r) => [r.id, r.name]));
  const { members, invitations } = staff.data;
  const share = (inv: StaffInvitation) =>
    void Share.share({ message: s.shareMessage(business.data.name, inv.inviteUrl) });

  const onRevoke = async (inv: StaffInvitation) => {
    if (await confirm(s.revokeTitle, s.revokeBody, s.revoke)) revoke.mutate(inv.id);
  };

  return (
    <StackScreen title={s.title} right={<HeaderIconButton icon="plus" label={s.invite} onPress={() => setInviting(true)} />}>
      <FormError message={revoke.error ? errorMessage(revoke.error) : null} />

      <SectionLabel label={s.team} />
      <Card className="overflow-hidden">
        {members.map((m, i) => (
          <ListRow
            key={m.memberId}
            title={m.name}
            subtitle={[m.email, m.resources.map((r) => r.name).join(', ')].filter(Boolean).join(' · ')}
            right={
              <Tag
                label={m.role === 'owner' ? s.owner : m.isActive ? s.staffRole : s.inactive}
                tone={m.role === 'owner' ? 'ok' : m.isActive ? 'info' : 'neutral'}
              />
            }
            onPress={m.role === 'staff' ? () => setEditing(m) : undefined}
            last={i === members.length - 1}
          />
        ))}
      </Card>
      {members.length === 1 && invitations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="users" size={32} color={colors.muted} />}
            title={s.empty}
            body={s.emptyBody}
            action={<Button title={s.invite} onPress={() => setInviting(true)} className="mt-2 w-48" />}
          />
        </Card>
      ) : null}

      {invitations.length ? (
        <>
          <SectionLabel label={s.pending} />
          <Card className="overflow-hidden">
            {invitations.map((inv, i) => (
              <View
                key={inv.id}
                className={`gap-2 px-3.5 py-3 ${i < invitations.length - 1 ? 'border-b border-border' : ''}`}
              >
                <View className="flex-row items-center gap-2">
                  <Icon name="mail" size={18} color={colors.muted} />
                  <View className="flex-1">
                    <Text className="text-[15px] font-bold">{inv.email}</Text>
                    <Text className="text-[12px] text-muted">
                      {[inv.resourceId ? resourceName.get(inv.resourceId) : null, s.expires(format(parseISO(inv.expiresAt), 'd MMM'))]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void onRevoke(inv)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.revoke}: ${inv.email}`}
                    className="h-11 w-11 items-center justify-center"
                  >
                    <Icon name="x" size={18} color={colors.muted} />
                  </Pressable>
                </View>
                <Button variant="secondary" title={s.share} onPress={() => share(inv)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <InviteSheet
        visible={inviting}
        onClose={() => setInviting(false)}
        resources={resources.data}
        label={label}
        onCreated={(inv) => {
          setInviting(false);
          share(inv);
        }}
      />
      <MemberSheet member={editing} resources={resources.data} label={label} onClose={() => setEditing(null)} />
    </StackScreen>
  );
}

function InviteSheet({
  visible,
  onClose,
  resources,
  label,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  resources: Resource[];
  label: string;
  onCreated: (inv: StaffInvitation) => void;
}) {
  const invite = useInviteStaff();
  const [email, setEmail] = useState('');
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setEmail('');
      setResourceId(null);
      setError(null);
      invite.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    const parsed = staffInviteSchema.safeParse({ email, resourceId });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a valid email');
    setError(null);
    invite.mutate(parsed.data, { onSuccess: onCreated });
  };

  // Resources already linked to someone are still offered: the owner may be re-assigning.
  return (
    <Sheet visible={visible} title={s.inviteTitle} onClose={onClose}>
      <Text className="text-[14px] text-muted">{s.inviteBody}</Text>
      <FormError message={invite.error ? errorMessage(invite.error) : null} />
      <TextField
        compact
        label={s.email}
        value={email}
        onChangeText={setEmail}
        error={error ?? undefined}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      {resources.length ? (
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{s.linkTo(label)}</Text>
          <Text className="text-[12px] text-muted">{s.linkHint}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip role="radio" label={s.none} selected={resourceId === null} onPress={() => setResourceId(null)} />
            {resources.map((r) => (
              <Chip key={r.id} role="radio" label={r.name} selected={resourceId === r.id} onPress={() => setResourceId(r.id)} />
            ))}
          </View>
        </View>
      ) : null}
      <Button title={s.send} loading={invite.isPending} onPress={submit} />
    </Sheet>
  );
}

function MemberSheet({
  member,
  resources,
  label,
  onClose,
}: {
  member: StaffMember | null;
  resources: Resource[];
  label: string;
  onClose: () => void;
}) {
  const update = useUpdateMember();
  const [isActive, setIsActive] = useState(true);
  const [canViewAll, setCanViewAll] = useState(false);
  const [linked, setLinked] = useState<number[]>([]);

  useEffect(() => {
    if (!member) return;
    setIsActive(member.isActive);
    setCanViewAll(member.canViewAll);
    setLinked(member.resources.map((r) => r.id));
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  if (!member) return null;
  return (
    <Sheet visible title={member.name} onClose={onClose}>
      <Text className="text-[14px] text-muted">{member.email}</Text>
      <FormError message={update.error ? errorMessage(update.error) : null} />
      <SwitchRow label={s.active} hint={s.activeHint} value={isActive} onChange={setIsActive} />
      <SwitchRow label={s.viewAll} hint={s.viewAllHint} value={canViewAll} onChange={setCanViewAll} />
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.linked(label)}</Text>
        {resources.length === 0 ? <Text className="text-[13px] text-muted">{s.noLinks}</Text> : null}
        <View className="flex-row flex-wrap gap-2">
          {resources.map((r) => {
            const on = linked.includes(r.id);
            return (
              <Chip
                key={r.id}
                label={r.name}
                selected={on}
                onPress={() => setLinked((cur) => (on ? cur.filter((x) => x !== r.id) : [...cur, r.id]))}
              />
            );
          })}
        </View>
      </View>
      <Button
        title={s.save}
        loading={update.isPending}
        onPress={() =>
          update.mutate({ memberId: member.memberId, isActive, canViewAll, resourceIds: linked }, { onSuccess: onClose })
        }
      />
    </Sheet>
  );
}
