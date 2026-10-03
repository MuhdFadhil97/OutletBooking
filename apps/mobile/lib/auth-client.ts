import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import { API_URL } from './config';

// On web the browser keeps the session cookie itself; this shim only satisfies the interface.
const getItem = (key: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key));
const setItem = (key: string, value: string) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
};
const webStorage = {
  getItem,
  setItem,
  getItemAsync: async (key: string) => getItem(key),
  setItemAsync: async (key: string, value: string) => setItem(key, value),
};

/** Better Auth client. On Android/iOS the session is kept in the encrypted SecureStore. */
export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  plugins: [
    expoClient({
      scheme: 'outletbooking',
      storagePrefix: 'outletbooking',
      storage: Platform.OS === 'web' ? webStorage : SecureStore,
    }),
  ],
});
