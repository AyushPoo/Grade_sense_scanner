import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../config';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface PortalScreenProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function PortalScreen({ title, subtitle, children, onRefresh, refreshing }: PortalScreenProps) {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {onRefresh && (
          <TouchableOpacity style={styles.iconButton} onPress={onRefresh} disabled={refreshing} activeOpacity={0.82}>
            {refreshing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="refresh" size={22} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function PortalCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function StatTile({ icon, label, value }: { icon: IconName; label: string; value: string | number }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIcon}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const toneStyle = {
    success: { backgroundColor: COLORS.successLight, color: COLORS.success },
    warning: { backgroundColor: COLORS.warningLight, color: COLORS.warning },
    error: { backgroundColor: COLORS.errorLight, color: COLORS.error },
    neutral: { backgroundColor: COLORS.surfaceElevated, color: COLORS.textLight },
  }[tone];

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[styles.pillText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

export function PortalActionButton({
  label,
  icon,
  onPress,
  tone = 'primary',
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const buttonStyle = tone === 'primary'
    ? styles.primaryButton
    : tone === 'danger'
      ? styles.dangerButton
      : styles.secondaryButton;
  const textStyle = tone === 'primary' ? styles.primaryButtonText : tone === 'danger' ? styles.dangerButtonText : styles.secondaryButtonText;

  return (
    <TouchableOpacity style={[styles.actionButton, buttonStyle, disabled && styles.disabled]} onPress={onPress} disabled={disabled} activeOpacity={0.82}>
      {icon && <Ionicons name={icon} size={17} color={tone === 'primary' ? '#fff' : tone === 'danger' ? COLORS.error : COLORS.primary} />}
      <Text style={textStyle}>{label}</Text>
    </TouchableOpacity>
  );
}

export function PortalState({
  title,
  message,
  loading,
  onRetry,
}: {
  title: string;
  message?: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.stateBox}>
      {loading ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="information-circle-outline" size={28} color={COLORS.textMuted} />}
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {onRetry && !loading ? <PortalActionButton label="Retry" icon="refresh" onPress={onRetry} tone="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.backgroundDark },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 2 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryXLight,
  },
  content: { padding: 18, paddingBottom: 32, gap: 16 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
  statTile: {
    flex: 1,
    minWidth: 96,
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryXLight,
    marginBottom: 8,
  },
  statValue: { fontSize: 24, fontWeight: '800', color: COLORS.primary },
  statLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700', marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11, fontWeight: '800' },
  actionButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: { backgroundColor: COLORS.primary },
  secondaryButton: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  dangerButton: { backgroundColor: COLORS.errorLight },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  secondaryButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
  dangerButtonText: { color: COLORS.error, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  stateBox: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
  },
  stateTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  stateMessage: { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 19 },
});
