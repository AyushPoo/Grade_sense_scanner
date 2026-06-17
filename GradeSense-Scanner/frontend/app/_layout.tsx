import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../src/store/authStore';
import { useScanStore } from '../src/store/scanStore';
import { roleHomeRoute, shouldRedirectRoleGroup } from '../src/utils/roleRouting';
import * as Sentry from '@sentry/react-native';
import { fetchWithTimeout } from '../src/utils/fetchWithTimeout';

// ── Sentry Crash Reporting ────────────────────────────────────────────────────
// Initialised once at module load, before any React tree mounts.
// Disabled in __DEV__ to avoid polluting the production project during development.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: sentryDsn || '',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 0.2, // capture 20% of transactions for performance monitoring
  enabled: !__DEV__ && !!sentryDsn,
});

function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  // Combine hydration states from both stores
  const authHasHydrated = useAuthStore(state => state.hasHydrated);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const user = useAuthStore(state => state.user);
  const scanHasHydrated = useScanStore(state => state.hasHydrated);
  const fetchSessions = useScanStore(state => state.fetchSessions);
  const performPostHydrationCleanup = useScanStore(state => state.performPostHydrationCleanup);

  const isAppReady = authHasHydrated && scanHasHydrated && !!navigationState?.key;

  console.log(`[TRACE] RootLayout: rendering at ${Date.now()}. isAppReady: ${isAppReady}, isAuthenticated: ${isAuthenticated}, segments: ${JSON.stringify(segments)}`);

  // ── Cloud Run Warmup Ping ─────────────────────────────────────────────────
  // Fires immediately on app mount (before any navigation).
  // Cloud Run scales to zero when idle; first request after a cold start can
  // take 10–15 s. This silent GET to the health route warms the DocAligner
  // instance so it is ready by the time the teacher opens the scanner (~30–60 s
  // after app launch).
  useEffect(() => {
    const doctrUrl = process.env.EXPO_PUBLIC_DOCTR_URL;
    if (!doctrUrl) return;
    const warmUp = async () => {
      try {
        await fetchWithTimeout(`${doctrUrl}/`, {}, 8000);
        console.log('[Warmup] DocAligner Cloud Run instance is warm.');
      } catch (_) {
        // Silent — warmup failure is non-critical; DocAligner will still be
        // called on the first scan, just with a cold-start latency penalty.
      }
    };
    warmUp();
  }, []);

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

  // ── PHASE 3 FIX: segments stored in a ref so the redirect effect does NOT re-run
  // on every navigation (every route change previously re-fired the guard via the dep array).
  // The ref is always up-to-date because the sync effect runs before any useEffect.
  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  });

  // 2. STABLE REDIRECTS: Guarded by isAppReady
  // PHASE 3 FIX: `segments` removed from dependency array — guard only fires when auth
  // state or app-ready state changes, not on every navigation transition.
  // Timeout increased from 1ms → 50ms so Expo Router can commit the navigation
  // before we evaluate the redirect condition (eliminates route bounce race condition).
  useEffect(() => {
    if (!isAppReady) return;

    const timeout = setTimeout(() => {
      const currentSegments = segmentsRef.current;
      const isAtRoot = !currentSegments.length || currentSegments[0] === undefined;
      const inAuthGroup = currentSegments[0] === '(auth)';

      if (!isAuthenticated) {
        if (!inAuthGroup) {
          console.log(`[TRACE] RootLayout: Redirecting to login at ${Date.now()}`);
          router.replace('/(auth)/login');
        }
      } else {
        const destination = roleHomeRoute(user?.role);
        const currentGroup = currentSegments[0];
        if (inAuthGroup || isAtRoot || shouldRedirectRoleGroup(user?.role, currentGroup)) {
          console.log(`[TRACE] RootLayout: Redirecting to ${destination} at ${Date.now()}`);
          router.replace(destination as any);
        }
      }
    }, 50);

    return () => clearTimeout(timeout);
  }, [isAppReady, isAuthenticated, user?.role]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(student)" />
          <Stack.Screen name="(admin)" />
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

// Wrap with Sentry for automatic crash boundary, breadcrumb tracking,
// and navigation transaction instrumentation.
export default Sentry.wrap(RootLayout);
