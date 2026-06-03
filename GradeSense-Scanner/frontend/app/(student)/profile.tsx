import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, SectionTitle } from '../../src/components/portal/PortalKit';

export default function StudentProfileScreen() {
  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);
  const router = useRouter();

  const signOut = () => {
    logout();
    router.replace('/(auth)/login');
  };

  return (
    <PortalScreen title="Profile" subtitle="Student account">
      <SectionTitle title="Account" />
      <PortalCard style={styles.card}>
        <Text style={styles.name}>{user?.name || 'Student'}</Text>
        <Text style={styles.meta}>{user?.email}</Text>
        <Text style={styles.meta}>{user?.org_name || 'GradeSense'}</Text>
      </PortalCard>
      <PortalActionButton label="Sign Out" icon="log-out-outline" onPress={signOut} tone="danger" />
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  name: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  meta: { fontSize: 14, color: COLORS.textLight },
});
