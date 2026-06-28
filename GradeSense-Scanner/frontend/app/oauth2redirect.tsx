import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../src/config';

export default function OAuth2RedirectScreen() {
  const { email, refresh_token, error } = useLocalSearchParams<{
    email?: string;
    refresh_token?: string;
    error?: string;
  }>();
  const router = useRouter();

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        // Dismiss the in-app browser session
        await WebBrowser.dismissBrowser();
      } catch (_) {}

      if (error) {
        Alert.alert('Link Failed', decodeURIComponent(error));
        router.replace('/(tabs)/manage');
        return;
      }

      if (!email || !refresh_token) {
        Alert.alert('Link Failed', 'Missing credentials from server.');
        router.replace('/(tabs)/manage');
        return;
      }

      try {
        const decodedEmail = decodeURIComponent(email);
        const decodedToken = decodeURIComponent(refresh_token);

        await AsyncStorage.setItem('gradesense.smtp.provider', 'gmail_oauth');
        await AsyncStorage.setItem('gradesense.gmail_oauth.email', decodedEmail);
        await AsyncStorage.setItem('gradesense.gmail_oauth.refresh_token', decodedToken);

        Alert.alert('Success', `Successfully linked Google account: ${decodedEmail}`);
      } catch (err: any) {
        Alert.alert('Error', 'Failed to save linked account details.');
      } finally {
        router.replace('/(tabs)/manage');
      }
    };

    handleRedirect();
  }, [email, refresh_token, error]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>Linking Google Account...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});
