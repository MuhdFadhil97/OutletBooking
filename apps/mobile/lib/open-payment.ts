import { Linking, Platform } from 'react-native';

/**
 * Opens a ToyyibPay payment page. On the web booking page the same tab navigates, so ToyyibPay's
 * return URL brings the customer straight back to their booking. In the app it opens the browser.
 */
export function openPaymentPage(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(url);
  else void Linking.openURL(url);
}
