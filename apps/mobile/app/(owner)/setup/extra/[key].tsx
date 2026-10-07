import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { MoneyField } from '@/components/ui/MoneyField';
import { SwitchRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useBusiness, useServices, useUpdateBusiness, useUpdateServices } from '@/features/setup/hooks';
import { formatDuration } from '@/lib/format';
import { t } from '@/strings/en';

const s = t.setup.setupExtra;
const TRAVEL = [0, 15, 30, 45, 60] as const;

/**
 * Type-specific Setup rows that need their own small screen:
 *  - travel (real estate): gap between viewings at the property + areas served
 *  - mobile (vehicle inspection): offer mobile inspection, fee, area
 * Both act on services with location "at the customer's address".
 */
export default function SetupExtraScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const business = useBusiness();
  const services = useServices();
  const saveServices = useUpdateServices();
  const saveBusiness = useUpdateBusiness();

  const mobileServices = (services.data ?? []).filter((x) => x.locationType === 'at_customer_location');
  const settings = business.data?.settings ?? {};

  const [travel, setTravel] = useState(0);
  const [area, setArea] = useState('');
  const [offer, setOffer] = useState(true);
  const [feeSen, setFeeSen] = useState(0);

  useEffect(() => {
    if (!business.data || !services.data) return;
    setTravel(Math.max(0, ...mobileServices.map((x) => x.travelBufferMin)));
    setArea(typeof settings.serviceArea === 'string' ? settings.serviceArea : '');
    setOffer(mobileServices.some((x) => x.isVisible));
    setFeeSen(typeof settings.mobileFeeSen === 'number' ? settings.mobileFeeSen : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.data, services.data]);

  if (key !== 'travel' && key !== 'mobile') return <ErrorState error={new Error(s.unknown)} />;
  const copy = s[key];
  if (business.isPending || services.isPending) return <LoadingState />;
  const error = business.error ?? services.error;
  if (error) return <ErrorState error={error} onRetry={() => void services.refetch()} />;

  if (!mobileServices.length) {
    return (
      <StackScreen title={copy.title}>
        <Card>
          <EmptyState title={s.noService} body={s.noServiceBody} />
        </Card>
      </StackScreen>
    );
  }

  const saving = saveServices.isPending || saveBusiness.isPending;
  const failed = saveServices.error ?? saveBusiness.error;

  const save = async () => {
    const edits = mobileServices.map((svc) => ({
      id: svc.id,
      body: key === 'travel' ? { travelBufferMin: travel } : { isVisible: offer },
    }));
    await saveServices.mutateAsync(edits);
    await saveBusiness.mutateAsync({
      settings: key === 'travel' ? { serviceArea: area.trim() || null } : { serviceArea: area.trim() || null, mobileFeeSen: feeSen },
    });
    router.back();
  };

  return (
    <StackScreen title={copy.title} footer={<Button title={s.save} loading={saving} onPress={() => void save().catch(() => undefined)} />}>
      <FormError message={failed ? errorMessage(failed) : null} />
      <Text className="text-[14px] text-muted">{copy.intro}</Text>
      <Card className="gap-4 p-4">
        {key === 'travel' ? (
          <View className="gap-2">
            <Text className="text-[13px] font-bold text-label">{s.travel.gap}</Text>
            <ChipChoice options={TRAVEL} value={travel} onChange={setTravel} format={(m) => (m ? formatDuration(m) : s.none)} />
            <Text className="text-[12px] text-muted">{s.travel.gapHint}</Text>
          </View>
        ) : (
          <>
            <SwitchRow label={s.mobile.offer} hint={s.mobile.offerHint} value={offer} onChange={setOffer} />
            <MoneyField label={s.mobile.fee} valueSen={feeSen} onChangeSen={setFeeSen} hint={s.mobile.feeHint} />
          </>
        )}
        <TextField compact label={copy.area} value={area} onChangeText={setArea} hint={copy.areaHint} />
      </Card>
    </StackScreen>
  );
}
