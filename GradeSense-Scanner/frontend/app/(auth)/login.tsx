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
  Modal,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { roleHomeRoute } from '../../src/utils/roleRouting';
import appIcon from '../../assets/images/icon.png';

// Required for OAuth flows in Expo
WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const CONTACT_EMAIL = 'ayush@gradesense.in';

type AccessRequestState = {
  email: string;
} | null;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [showDemoWarning, setShowDemoWarning] = useState(false);
  const [accessRequest, setAccessRequest] = useState<AccessRequestState>(null);
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
      const { authentication, params } = response;
      const idToken = authentication?.idToken || params?.id_token;
      const accessToken = authentication?.accessToken || params?.access_token;

      if (idToken) {
        handleGoogleIdToken(idToken);
      } else if (accessToken) {
        fetchUserInfoAndAuth(accessToken);
      } else {
        setError('Google sign-in completed, but no usable token was returned. Please try again.');
        setIsLoading(false);
      }
    } else if (response?.type === 'error') {
      setError('Google sign-in failed: ' + (response.error?.message || 'Unknown error'));
      setIsLoading(false);
    } else if (response?.type === 'dismiss' || response?.type === 'cancel') {
      setIsLoading(false);
    } else if (response?.type === 'locked') {
      setError('A Google sign-in is already in progress. Close the browser window and try again.');
      setIsLoading(false);
    }
  }, [response]);

  const buildClientContext = () => ({
    source: 'mobile',
    appVersion: Application.nativeApplicationVersion || Constants.expoConfig?.version || null,
    buildVersion: Application.nativeBuildVersion || null,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceName: Constants.deviceName || null,
    appOwnership: Constants.appOwnership || null,
    executionEnvironment: Constants.executionEnvironment || null,
  });

  const extractAuthError = (errData: any) => {
    const detail = errData?.detail;
    const errorDetails = errData?.error?.details;
    const payload = typeof detail === 'object' && detail ? detail : errData;
    return {
      code: payload?.code || errorDetails?.code || errData?.error?.code,
      message:
        payload?.message ||
        (typeof detail === 'string' ? detail : undefined) ||
        errData?.error?.message ||
        'Google authentication failed',
      email: payload?.email || errorDetails?.email,
      accessRequestCreated: Boolean(payload?.accessRequestCreated || errorDetails?.accessRequestCreated),
    };
  };

  const handleInviteRequired = (authError: ReturnType<typeof extractAuthError>) => {
    if (authError.code !== 'INVITE_REQUIRED' && authError.code !== 'ACCESS_REQUEST_CREATED') {
      return false;
    }
    setAccessRequest({ email: authError.email || 'this Google account' });
    setError(null);
    return true;
  };

  const completeAuthenticatedLogin = (data: any) => {
    setUser(data.user);
    setSessionToken(data.session_token);
    setIsAuthenticated(true);
    router.replace(roleHomeRoute(data.user?.role) as any);
  };

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
        body: JSON.stringify({ access_token: accessToken, token_info: tokenInfo, client_context: buildClientContext() }),
      });
      if (!backendRes.ok) {
        const errData = await backendRes.json().catch(() => ({}));
        const authError = extractAuthError(errData);
        if (handleInviteRequired(authError)) return;
        throw new Error(authError.message);
      }
      const data = await backendRes.json();
      completeAuthenticatedLogin(data);
    } catch (err: any) {
      setError(err.message || 'Google sign-in could not complete. Please try again.');
    } finally { setIsLoading(false); }
  };

  const handleGoogleIdToken = async (idToken: string) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/auth/google-idtoken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({ id_token: idToken, client_context: buildClientContext() }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const authError = extractAuthError(errData);
        if (handleInviteRequired(authError)) return;
        throw new Error(authError.message);
      }
      const data = await res.json();
      completeAuthenticatedLogin(data);
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
      completeAuthenticatedLogin(data);
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate. Please check your credentials.');
    } finally { setIsLoading(false); }
  };

  const handleGoogleLogin = async () => {
    if (!GOOGLE_CLIENT_ID) { setError('Google sign-in is not configured. Please use email/password.'); return; }
    if (!request) { setError('Google sign-in is still loading. Please try again in a moment.'); return; }
    try {
      setIsLoading(true); setError(null);
      const result = await promptAsync();
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setIsLoading(false);
      } else if (result.type === 'locked') {
        setError('A Google sign-in is already in progress. Close the browser window and try again.');
        setIsLoading(false);
      } else if (result.type === 'error') {
        setError('Google sign-in failed: ' + (result.error?.message || 'Unknown error'));
        setIsLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to start Google sign-in. Please try again.');
      setIsLoading(false);
    }
  };

  const contactAyush = () => {
    const subject = encodeURIComponent('GradeSense access request');
    const body = encodeURIComponent(`Hi Ayush,\n\nI tried to sign in to GradeSense with ${accessRequest?.email || 'my Google account'} and would like access.`);
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {
      setError(`Could not open your email app. Please contact ${CONTACT_EMAIL}.`);
    });
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
              <Image source={appIcon} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.appName}>GradeSense</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in with your invited Google account</Text>
            <Text style={styles.cardSub}>Use the same Google email that GradeSense invited for testing.</Text>

            {/* Error */}
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={COLORS.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Google */}
            <TouchableOpacity style={[styles.primaryBtn, (!request || isLoading) && { opacity: 0.65 }]} onPress={handleGoogleLogin} disabled={isLoading || !request} activeOpacity={0.85}>
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={19} color="#fff" />
                  <Text style={styles.primaryBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>other options</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Email */}
            <TouchableOpacity style={styles.emailToggle} onPress={() => setShowEmailLogin(v => !v)} disabled={isLoading} activeOpacity={0.75}>
              <View style={styles.emailToggleTextWrap}>
                <Text style={styles.emailToggleTitle}>Use email instead</Text>
                <Text style={styles.emailToggleSub}>Only if GradeSense gave you a password.</Text>
              </View>
              <Ionicons name={showEmailLogin ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textLight} />
            </TouchableOpacity>

            {showEmailLogin && (
              <View style={styles.emailPanel}>
                <Text style={styles.helperText}>Most testers should use Google sign-in with their invited email.</Text>

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

                <TouchableOpacity style={[styles.secondaryBtn, isLoading && { opacity: 0.7 }]} onPress={handleEmailLogin} disabled={isLoading} activeOpacity={0.85}>
                  <Text style={styles.secondaryBtnText}>Sign in with email</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Guest / Demo */}
            <TouchableOpacity style={styles.guestBtn} onPress={() => setShowDemoWarning(true)} disabled={isLoading} activeOpacity={0.75}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textLight} />
              <Text style={styles.guestBtnText}>Preview demo</Text>
            </TouchableOpacity>

            <Text style={styles.terms}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </Text>
          </View>

          <Text style={styles.footer}>Powered by GradeSense</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showDemoWarning} transparent animationType="fade" onRequestClose={() => setShowDemoWarning(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWarning}>
              <Ionicons name="alert-circle-outline" size={24} color={COLORS.warning} />
            </View>
            <Text style={styles.modalTitle}>Demo mode is only a preview</Text>
            <Text style={styles.modalBody}>
              You can look around, but demo mode does not sync, grade papers, or upload real exams. To use GradeSense, sign in with the Google account that was invited.
            </Text>
            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => { setShowDemoWarning(false); handleGoogleLogin(); }}
              disabled={isLoading || !request}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-google" size={18} color="#fff" />
              <Text style={styles.modalPrimaryText}>Use Google sign-in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalGhostBtn}
              onPress={() => { setShowDemoWarning(false); handleMockLogin(); }}
              activeOpacity={0.75}
            >
              <Text style={styles.modalGhostText}>Preview demo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(accessRequest)} transparent animationType="fade" onRequestClose={() => setAccessRequest(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconInfo}>
              <Ionicons name="mail-outline" size={24} color={COLORS.info} />
            </View>
            <Text style={styles.modalTitle}>Thanks for your interest</Text>
            <Text style={styles.modalBody}>
              GradeSense is invite-only while we are testing. We saved your request for {accessRequest?.email}. Ayush will reach out with access details.
            </Text>
            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => setAccessRequest(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalPrimaryText}>Back to sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalGhostBtn}
              onPress={contactAyush}
              activeOpacity={0.75}
            >
              <Text style={styles.modalGhostText}>Contact {CONTACT_EMAIL}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    overflow: 'hidden',
  },
  logoImage: {
    width: 76,
    height: 76,
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  // Card
  card: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  cardTitle: { fontSize: 21, fontWeight: '800', color: COLORS.text, marginBottom: 6, lineHeight: 27 },
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

  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 48,
    backgroundColor: COLORS.text,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },

  // Email
  emailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    padding: 14,
    marginBottom: 12,
  },
  emailToggleTextWrap: { flex: 1 },
  emailToggleTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  emailToggleSub: { fontSize: 12, color: COLORS.textLight, lineHeight: 17 },
  emailPanel: {
    marginBottom: 12,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 17,
    marginBottom: 10,
  },

  // Guest
  guestBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
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

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  modalIconWarning: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.warningLight,
    marginBottom: 14,
  },
  modalIconInfo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.infoLight,
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 21,
    marginBottom: 18,
  },
  modalPrimaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modalPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  modalGhostBtn: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  modalGhostText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
});
