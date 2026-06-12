import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';

WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => {
      router.replace({
        pathname: '/(auth)/login',
        params: {
          auth_error: 'Google sign-in did not finish. Please try again.',
        },
      });
    }, 12000);

    return () => clearTimeout(timeout);
  }, [router]);

  const returnToLogin = () => {
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.title}>Completing sign in</Text>
      <Text style={styles.caption}>Please wait while GradeSense verifies your Google account.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={returnToLogin} activeOpacity={0.78}>
        <Text style={styles.retryText}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
  },
  title: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  caption: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 22,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryXLight,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
