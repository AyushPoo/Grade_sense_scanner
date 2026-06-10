import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { roleHomeRoute } from '../src/utils/roleRouting';
import brandMark from '../assets/images/splash-icon.png';

export default function IndexScreen() {
  const router = useRouter();
  const hasHydrated = useAuthStore(state => state.hasHydrated);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (!hasHydrated) return;

    const timeout = setTimeout(() => {
      router.replace(isAuthenticated ? (roleHomeRoute(user?.role) as any) : '/(auth)/login');
    }, 50);

    return () => clearTimeout(timeout);
  }, [hasHydrated, isAuthenticated, router, user?.role]);

  return (
    <View style={styles.root}>
      <Image source={brandMark} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  logo: {
    width: 128,
    height: 128,
  },
});
