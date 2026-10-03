import { PlaceholderScreen } from '@/components/Placeholder';
import { t } from '@/strings/en';

export default function StaffTodayScreen() {
  return <PlaceholderScreen title={t.tabs.today} body={t.placeholder.staffToday} icon="home" />;
}
