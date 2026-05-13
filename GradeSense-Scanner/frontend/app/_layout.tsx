import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../src/store/authStore';
import { useScanStore } from '../src/store/scanStore';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  
  // Combine hydration states from both stores
  const authHasHydrated = useAuthStore(state => state.hasHydrated);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const scanHasHydrated = useScanStore(state => state.hasHydrated);
  const fetchSessions = useScanStore(state => state.fetchSessions);
  const performPostHydrationCleanup = useScanStore(state => state.performPostHydrationCleanup);

  const isAppReady = authHasHydrated && scanHasHydrated && !!navigationState?.key;

  console.log(`[TRACE] RootLayout: rendering at ${Date.now()}. isAppReady: ${isAppReady}, isAuthenticated: ${isAuthenticated}, segments: ${JSON.stringify(segments)}`);

  // 1. BOOTSTRAP SEQUENCE: Side effects only after full hydration
  useEffect(() => {
    if (authHasHydrated && scanHasHydrated) {
      console.log(`[TRACE] RootLayout: Starting Bootstrap Lifecycle at ${Date.now()}`);
      
      // Execute post-hydration cleanup (integrity check, stuck session reset)
      // This is now separated from the storage read phase to avoid write recursion
      performPostHydrationCleanup().catch(e => console.error('[Bootstrap] Cleanup failed:', e));

      // Fetch fresh sessions if authenticated
      if (isAuthenticated) {
        fetchSessions().catch(e => console.error('[Bootstrap] Initial fetch failed:', e));
      }
    }
  }, [authHasHydrated, scanHasHydrated, isAuthenticated]);

  // 2. STABLE REDIRECTS: Guarded by isAppReady
  useEffect(() => {
    if (!isAppReady) return;

    // Use a small delay to ensure Expo Router is stable
    const timeout = setTimeout(() => {
      const inAuthGroup = segments[0] === '(auth)' || segments[0] === undefined;

      if (!isAuthenticated && !inAuthGroup) {
        console.log(`[TRACE] RootLayout: Redirecting to login at ${Date.now()}`);
        router.replace('/');
      } else if (isAuthenticated && inAuthGroup) {
        console.log(`[TRACE] RootLayout: Redirecting to home at ${Date.now()}`);
        router.replace('/(tabs)/home');
      }
    }, 1);

    return () => clearTimeout(timeout);
  }, [isAppReady, isAuthenticated, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="scanner" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="session-setup" options={{ presentation: 'card' }} />
          <Stack.Screen name="review" options={{ presentation: 'card' }} />
          <Stack.Screen name="upload" options={{ presentation: 'card' }} />
          <Stack.Screen name="page-preview" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}



