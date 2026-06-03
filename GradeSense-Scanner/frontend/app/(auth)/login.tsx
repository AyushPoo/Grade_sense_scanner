import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { roleHomeRoute } from '../../src/utils/roleRouting';

// Required for OAuth flows in Expo
WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const router = useRouter();
  const { setUser, setSessionToken, setIsAuthenticated } = useAuthStore();

  // Native Google OAuth
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || GOOGLE_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || GOOGLE_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
    extraParams: { access_type: 'online' },
  });

  React.useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.idToken) {
        handleGoogleIdToken(authentication.idToken);
      } else if (authentication?.accessToken) {
        fetchUserInfoAndAuth(authentication.accessToken);
      } else {
        setError('Google sign-in did not return an ID token. Please try again.');
        setIsLoading(false);
      }
    } else if (response?.type === 'error') {
      setError('Google sign-in failed: ' + (response.error?.message || 'Unknown error'));
      setIsLoading(false);
    } else if (response?.type === 'dismiss' || response?.type === 'cancel') {
      setIsLoading(false);
    }
  }, [response]);

  const fetchUserInfoAndAuth = async (accessToken: string) => {
    try {
      const tokenInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`
      );
      if (!tokenInfoRes.ok) throw new Error('Failed to verify Google access token');
      const tokenInfo = await tokenInfoRes.json();

      const backendRes = await fetch(`${getBackendUrl()}/api/auth/google-idtoken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ access_token: accessToken, token_info: tokenInfo }),
      });
      if (!backendRes.ok) {
        const errData = await backendRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Google authentication failed');
      }
      const data = await backendRes.json();
      setUser(data.user); setSessionToken(data.session_token); setIsAuthenticated(true);
      router.replace(roleHomeRoute(data.user?.role) as any);
    } catch (err: any) {
      setError(err.message || 'Google sign-in could not complete. Please use email/password instead.');
    } finally { setIsLoading(false); }
  };

  const handleGoogleIdToken = async (idToken: string) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/auth/google-idtoken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Google authentication failed');
      }
      const data = await res.json();
      setUser(data.user); setSessionToken(data.session_token); setIsAuthenticated(true);
      router.replace(roleHomeRoute(data.user?.role) as any);
    } catch (err: any) {
      setError(err.message || 'Failed to complete Google sign-in.');
    } finally { setIsLoading(false); }
  };

  const handleEmailLogin = async () => {
    if (!email.trim() || !password.trim()) { setError('Please enter both email and password'); return; }
    try {
      setIsLoading(true); setError(null);
      const res = await fetch(`${getBackendUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Authentication failed');
      }
      const data = await res.json();
      setUser(data.user); setSessionToken(data.session_token); setIsAuthenticated(true);
      router.replace(roleHomeRoute(data.user?.role) as any);
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate. Please check your credentials.');
    } finally { setIsLoading(false); }
  };

  const handleGoogleLogin = () => {
    if (!GOOGLE_CLIENT_ID) { setError('Google sign-in is not configured. Please use email/password.'); return; }
    setIsLoading(true); setError(null);
    promptAsync();
  };

  const handleMockLogin = () => {
    const mockUser = {
      user_id: 'user_mock_001',
      email: 'teacher@gradesense.io',
      name: 'Demo Teacher',
      picture: null,
      role: 'teacher',
      org_name: 'GradeSense Academy',
      created_at: new Date().toISOString(),
    };
    setUser(mockUser as any);
    setSessionToken('sess_mock_token_12345');
    setIsAuthenticated(true);
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Wordmark */}
          <View style={styles.wordmark}>
            <View style={styles.logoBox}>
              <Text style={styles.logoG}>G</Text>
            </View>
            <Text style={styles.appName}>GradeSense</Text>
            <Text style={styles.appTag}>Scanner</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.cardSub}>Access your batches and sync student papers</Text>

            {/* Error */}
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={COLORS.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <View style={[styles.inputWrap, focusedField === 'email' && styles.inputFocused]}>
              <Ionicons name="mail-outline" size={18} color={focusedField === 'email' ? COLORS.primary : COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={t => { setEmail(t); setError(null); }}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                editable={!isLoading}
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={[styles.inputWrap, focusedField === 'password' && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={18} color={focusedField === 'password' ? COLORS.primary : COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                value={password}
                onChangeText={t => { setPassword(t); setError(null); }}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                editable={!isLoading}
                returnKeyType="done"
                onSubmitEditing={handleEmailLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Primary button */}
            <TouchableOpacity style={[styles.primaryBtn, isLoading && { opacity: 0.7 }]} onPress={handleEmailLogin} disabled={isLoading} activeOpacity={0.85}>
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Sign In</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Google */}
            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleLogin} disabled={isLoading} activeOpacity={0.82}>
              <Ionicons name="logo-google" size={18} color="#4285F4" />
              <Text style={styles.googleBtnText}>Google</Text>
            </TouchableOpacity>

            {/* Guest / Demo */}
            <TouchableOpacity style={styles.guestBtn} onPress={handleMockLogin} disabled={isLoading} activeOpacity={0.75}>
              <Text style={styles.guestBtnText}>Continue as Guest (Demo)</Text>
            </TouchableOpacity>

            <Text style={styles.terms}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </Text>
          </View>

          <Text style={styles.footer}>Powered by GradeSense</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.backgroundDark },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 32,
    alignItems: 'center',
  },

  // Wordmark
  wordmark: {
    alignItems: 'center',
    marginTop: 48,
    marginBottom: 32,
  },
  logoBox: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  logoG: {
    fontSize: 44,
    fontWeight: '800',
    color: COLORS.primary,
    lineHeight: 52,
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  appTag: {
    fontSize: 15,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },

  // Card
  card: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  cardSub: { fontSize: 13, color: COLORS.textLight, lineHeight: 19, marginBottom: 20 },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: COLORS.errorLight,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${COLORS.error}30`,
  },
  errorText: { flex: 1, fontSize: 13, color: COLORS.error, lineHeight: 18 },

  // Input
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    marginBottom: 12,
    height: 54,
    paddingHorizontal: 14,
  },
  inputFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryXLight,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: COLORS.text },
  eyeBtn: { padding: 4 },

  // Primary button
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 54,
    marginTop: 4,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },

  // Google
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    height: 52,
    backgroundColor: COLORS.surface,
    marginBottom: 10,
  },
  googleBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.text },

  // Guest
  guestBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundDark,
  },
  guestBtnText: { fontSize: 14, color: COLORS.textLight, fontWeight: '500' },

  terms: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
  },

  footer: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 24,
    textAlign: 'center',
  },
});
