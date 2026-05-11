import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';

const COLORS = {
  primary: '#FF6B35',
  primaryDark: '#E55A2B',
  background: '#FFFFFF',
  text: '#1A1A1A',
  textLight: '#666666',
  textMuted: '#999999',
  error: '#F44336',
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BACKEND_URL) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_BACKEND_URL');
}

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { setUser, setSessionToken, setIsAuthenticated } = useAuthStore();

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const redirectUrl = Linking.createURL('callback');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      
      console.log('Opening auth URL:', authUrl);
      console.log('Redirect URL:', redirectUrl);

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      
      console.log('Auth result:', result);

      if (result.type === 'success' && result.url) {
        const url = result.url;
        const hashIndex = url.indexOf('#');
        
        if (hashIndex !== -1) {
          const fragment = url.substring(hashIndex + 1);
          const params = new URLSearchParams(fragment);
          const sessionId = params.get('session_id');
          
          if (sessionId) {
            console.log('Got session_id, processing...');
            await processSession(sessionId);
          } else {
            setError('No session ID received from authentication');
          }
        } else {
          setError('Invalid callback URL format');
        }
      } else if (result.type === 'cancel') {
        setError('Login was cancelled');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const processSession = async (sessionId: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/session`, {
        method: 'GET',
        headers: {
          'X-Session-ID': sessionId,
          'Content-Type': 'application/json',
          'Bypass-Tunnel-Reminder': 'true',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to process session');
      }

      const data = await response.json();
      console.log('Session processed:', data.user?.email);

      setUser(data.user);
      setSessionToken(data.session_token);
      setIsAuthenticated(true);

      router.replace('/(tabs)/home');
    } catch (err) {
      console.error('Session processing error:', err);
      setError('Failed to complete login. Please try again.');
    }
  };

  const handleMockLogin = () => {
    console.log('Using mock login bypass...');
    const mockUser = {
      user_id: 'user_mock_001',
      email: 'rahul.kumar@gradesense.com',
      name: 'Rahul Kumar',
      picture: 'https://ui-avatars.com/api/?name=Rahul+Kumar&background=FF6B35&color=fff',
      role: 'teacher',
      org_name: 'GradeSense Academy',
      created_at: new Date().toISOString()
    };

    setUser(mockUser as any);
    setSessionToken('sess_mock_token_12345');
    setIsAuthenticated(true);
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.primaryDark]}
        style={styles.headerGradient}
      >
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="scan" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.appName}>GradeSense</Text>
          <Text style={styles.tagline}>Scanner</Text>
        </View>
      </LinearGradient>

      <View style={styles.contentContainer}>
        <Text style={styles.welcomeTitle}>Welcome</Text>
        <Text style={styles.welcomeSubtitle}>
          Scan student answer papers with intelligent auto-detection
        </Text>

        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={20} color={COLORS.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleLogin}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <View style={styles.googleIconContainer}>
                <Ionicons name="logo-google" size={24} color="#fff" />
              </View>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bypassButton}
          onPress={handleMockLogin}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          <Text style={styles.bypassButtonText}>Continue as Guest (Skip Login)</Text>
        </TouchableOpacity>

        <Text style={styles.termsText}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by Emergent</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerGradient: {
    paddingTop: 40,
    paddingBottom: 60,
    alignItems: 'center',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  tagline: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 24,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    flex: 1,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  googleIconContainer: {
    marginRight: 12,
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  termsText: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  bypassButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
  },
  bypassButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
  },
});
