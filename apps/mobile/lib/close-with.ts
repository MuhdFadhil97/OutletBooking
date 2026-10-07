import { router } from 'expo-router';
import { showToast } from '@/components/ui/Toast';

/** After a successful save / delete on a pushed screen: confirm with a toast (D9) and go back. */
export const closeWith = (message: string) => () => {
  showToast(message);
  router.back();
};
