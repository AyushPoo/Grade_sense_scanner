import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { COLORS } from '../../src/config';

// Complete the Google AuthSession return. Do not navigate away from this route:
// Android returns to com.ayushp123.gradesensescanner:/oauthredirect while
// promptAsync is still resolving on the login screen.
WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirect() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.title}>Completing sign in</Text>
      <Text style={styles.caption}>Please wait while GradeSense verifies your Google account.</Text>
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
});
