import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';

export default function CallbackScreen() {
  const router = useRouter();
  const hasProcessed = useRef(false);
  const { setUser, setSessionToken, setIsAuthenticated } = useAuthStore();

  useEffect(() => {
    // Prevent double processing in StrictMode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processCallback = async () => {
      try {
        // Get session_id from URL
        const url = window?.location?.href || '';
        const hashIndex = url.indexOf('#');
        
        if (hashIndex !== -1) {
          const fragment = url.substring(hashIndex + 1);
          const params = new URLSearchParams(fragment);
          const sessionId = params.get('session_id');
          
          if (sessionId) {
            console.log('Processing session from callback...');
            
            const response = await fetch(`${getBackendUrl()}/api/auth/session`, {
              method: 'GET',
              headers: {
                'X-Session-ID': sessionId,
                'Content-Type': 'application/json',
              },
            });

            if (response.ok) {
              const data = await response.json();
              setUser(data.user);
              setSessionToken(data.session_token);
              setIsAuthenticated(true);
              router.replace('/(tabs)/home');
              return;
            }
          }
        }
        
        // Fallback to login
        router.replace('/(auth)/login');
      } catch (error) {
        console.error('Callback error:', error);
        router.replace('/(auth)/login');
      }
    };

    processCallback();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>Completing login...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
});
