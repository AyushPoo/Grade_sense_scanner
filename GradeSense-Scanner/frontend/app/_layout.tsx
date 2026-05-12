import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../src/store/authStore';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const { isAuthenticated, hasHydrated } = useAuthStore();

  useEffect(() => {
    // Wait for both hydration AND the root navigation state to be ready
    if (!hasHydrated || !navigationState?.key) return;

    // Use a small delay to ensure Expo Router has fully mounted its internal state
    const timeout = setTimeout(() => {
      const inAuthGroup = segments[0] === '(auth)' || segments[0] === undefined;

      if (!isAuthenticated && !inAuthGroup) {
        // If not authenticated and not in auth group, redirect to login
        console.log('Redirecting to login: not authenticated');
        router.replace('/');
      } else if (isAuthenticated && inAuthGroup) {
        // If authenticated and in auth group, redirect to home
        console.log('Redirecting to home: authenticated');
        router.replace('/(tabs)/home');
      }
    }, 1); // 1ms delay is often enough to push it to the next event loop tick

    return () => clearTimeout(timeout);
  }, [isAuthenticated, hasHydrated, segments, navigationState?.key]);

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



