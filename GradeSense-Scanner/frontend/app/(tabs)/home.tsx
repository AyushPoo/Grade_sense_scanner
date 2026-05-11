import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';

export default function HomeScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { savedSessions, fetchSessions } = useScanStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Fetch sessions from backend on mount
    fetchSessions().catch(err => console.error('Initial fetch failed:', err));
  }, []);

  // Ensure savedSessions is always an array to avoid crashes
  const sessions = Array.isArray(savedSessions) ? savedSessions : [];

  // Calculate stats safely
  const todaySessions = sessions.filter(s => {
    if (!s.created_at) return false;
    const today = new Date().toDateString();
    return new Date(s.created_at).toDateString() === today;
  }).length;

  const pendingUploads = sessions.filter(s => 
    s.status === 'ready' || s.status === 'failed'
  ).length;

  const totalPages = sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0);

  // Define recentSessions safely
  const recentSessions = sessions.slice(0, 5);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchSessions();
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleNewScan = () => {
    router.push('/session-setup');
  };

  const handleViewSessions = () => {
    router.push('/(tabs)/sessions');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploaded': return { icon: 'checkmark-circle', color: COLORS.success };
      case 'ready': return { icon: 'time', color: COLORS.warning };
      case 'failed': return { icon: 'alert-circle', color: COLORS.error };
      default: return { icon: 'document', color: COLORS.textMuted };
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.primaryDark]}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.appTitle}>GradeSense Scanner</Text>
            <Text style={styles.welcomeText}>Welcome, {user?.name || 'Teacher'}</Text>
            <Text style={styles.orgText}>{user?.org_name || 'Your Organization'}</Text>
          </View>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => {
              logout();
              router.replace('/(auth)/login');
            }}
          >
            <Ionicons name="log-out-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Main Actions */}
        <TouchableOpacity style={styles.mainCard} onPress={handleNewScan} activeOpacity={0.9}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            style={styles.mainCardGradient}
          >
            <View style={styles.mainCardIcon}>
              <Ionicons name="camera" size={40} color={COLORS.primary} />
            </View>
            <Text style={styles.mainCardTitle}>NEW SCAN SESSION</Text>
            <Text style={styles.mainCardSubtitle}>Start scanning student papers</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryCard} onPress={handleViewSessions} activeOpacity={0.9}>
          <View style={styles.secondaryCardContent}>
            <View style={styles.secondaryCardIcon}>
              <Ionicons name="folder-open" size={32} color={COLORS.primary} />
            </View>
            <View style={styles.secondaryCardText}>
              <Text style={styles.secondaryCardTitle}>SAVED SESSIONS</Text>
              <Text style={styles.secondaryCardSubtitle}>View and upload previous scans</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color={COLORS.textMuted} />
          </View>
        </TouchableOpacity>

        {/* Quick Stats */}
        <Text style={styles.sectionTitle}>QUICK STATS</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{todaySessions}</Text>
            <Text style={styles.statLabel}>Sessions Today</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, pendingUploads > 0 && { color: COLORS.warning }]}>
              {pendingUploads}
            </Text>
            <Text style={styles.statLabel}>Pending Upload</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalPages}</Text>
            <Text style={styles.statLabel}>Total Pages</Text>
          </View>
        </View>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>RECENT SESSIONS</Text>
            <View style={styles.sessionsList}>
              {recentSessions.map((session) => {
                const status = getStatusIcon(session.status);
                return (
                  <TouchableOpacity
                    key={session.session_id}
                    style={styles.sessionItem}
                    onPress={() => router.push({
                      pathname: '/review',
                      params: { sessionId: session.session_id }
                    })}
                  >
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionName}>{session.session_name}</Text>
                      <Text style={styles.sessionDetails}>
                        {(session.stats?.total_students || 0)} students • {(session.stats?.total_pages || 0)} pages
                      </Text>
                    </View>
                    <View style={styles.sessionStatus}>
                      <Ionicons name={status.icon as any} size={20} color={status.color} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  welcomeText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  orgText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  logoutButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  mainCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  mainCardGradient: {
    padding: 24,
    alignItems: 'center',
  },
  mainCardIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  mainCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  mainCardSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  secondaryCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  secondaryCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  secondaryCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  secondaryCardText: {
    flex: 1,
  },
  secondaryCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.5,
  },
  secondaryCardSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  sessionsList: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  sessionDetails: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  sessionStatus: {
    marginLeft: 12,
  },
});
