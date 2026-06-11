import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { AnalyticsPerformancePanel } from '../../src/components/manage/AnalyticsPerformancePanel';
import { useInsightsData } from '../../src/hooks/useInsightsData';

function MetricCard({
  value,
  label,
  icon,
  color,
  background,
}: {
  value: string | number;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  background: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function InsightsScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const loadedTokenRef = useRef<string | null>(null);
  const {
    overview,
    performance,
    isLoading,
    isRefreshing,
    isOffline,
    refresh,
  } = useInsightsData({ token });

  useEffect(() => {
    if (loadedTokenRef.current === token) return;
    loadedTokenRef.current = token || null;
    refresh();
  }, [refresh, token]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loader} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loaderText}>Loading synced insights...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Insights</Text>
          <Text style={styles.headerSub}>Performance insights</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => refresh()} activeOpacity={0.8}>
          <Ionicons name="refresh" size={19} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh()} tintColor={COLORS.primary} />}
      >
        {isOffline ? (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={18} color={COLORS.warning} />
            <Text style={styles.offlineText}>Some synced insight data could not be loaded.</Text>
          </View>
        ) : null}

        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.spotlightCard}>
          <View>
            <Text style={styles.spotlightLabel}>Class Average</Text>
            <Text style={styles.spotlightValue}>{Math.round(overview?.averagePercentage ?? 0)}%</Text>
            <Text style={styles.spotlightSub}>Across all graded exams</Text>
          </View>
          <Ionicons name="analytics-outline" size={44} color="rgba(255,255,255,0.34)" />
        </LinearGradient>

        <View style={styles.metricRow}>
          <MetricCard value={overview?.examsCount ?? 0} label="Exams" icon="school" color={COLORS.info} background={COLORS.infoLight} />
          <MetricCard value={overview?.submissionsCount ?? 0} label="Submissions" icon="documents" color={COLORS.primary} background={COLORS.primaryXLight} />
          <MetricCard value={overview?.reviewedCount ?? 0} label="Reviewed" icon="checkmark-done" color={COLORS.success} background={COLORS.successLight} />
        </View>

        <Text style={styles.sectionLabel}>Synced Performance</Text>
        <AnalyticsPerformancePanel performance={performance} isLoading={false} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.backgroundDark },
  loader: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', backgroundColor: COLORS.backgroundDark },
  loaderText: { color: COLORS.textLight, fontSize: 14 },
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: COLORS.text, fontSize: 23, fontWeight: '800' },
  headerSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  refreshBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  segmentContainer: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 3,
  },
  segmentBtn: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 9,
  },
  segmentBtnActive: { backgroundColor: COLORS.primary },
  segmentText: { color: COLORS.textLight, fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  offlineBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.warningLight,
    borderColor: `${COLORS.warning}44`,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offlineText: { color: COLORS.warning, flex: 1, fontSize: 12, fontWeight: '700' },
  spotlightCard: {
    alignItems: 'flex-end',
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    padding: 20,
  },
  spotlightLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '700' },
  spotlightValue: { color: '#fff', fontSize: 42, fontWeight: '900', lineHeight: 48 },
  spotlightSub: { color: 'rgba(255,255,255,0.78)', fontSize: 12 },
  metricRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  metricCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  metricIcon: { alignItems: 'center', borderRadius: 9, height: 32, justifyContent: 'center', marginBottom: 7, width: 32 },
  metricValue: { fontSize: 22, fontWeight: '900' },
  metricLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
});
