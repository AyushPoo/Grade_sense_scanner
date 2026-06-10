import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../config';

interface ScannerHeaderProps {
  phaseTitle: string;
  pageCount: number;
  studentsWithPagesCount?: number;
  showStudentCount: boolean;
  pageMode: 'single' | 'double';
  isLandscape: boolean;
  onBack: () => void;
  isPaused?: boolean;
  onTogglePageMode?: () => void;
  onTogglePause?: () => void;
}

const ScannerHeaderBase: React.FC<ScannerHeaderProps> = ({
  phaseTitle,
  pageCount,
  studentsWithPagesCount,
  showStudentCount,
  pageMode,
  isLandscape,
  onBack,
  isPaused,
  onTogglePageMode,
  onTogglePause,
}) => {
  // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
  if (__DEV__) {
    console.log(`[RENDER] ScannerHeader: ${phaseTitle}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.phaseTitle}>{phaseTitle}</Text>
          <Text style={styles.pageCount}>
            Pages: {pageCount}
            {showStudentCount && ` • Students: ${studentsWithPagesCount}`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onTogglePageMode}
          disabled={!onTogglePageMode}
          style={[styles.pageModeBadge, onTogglePageMode && styles.pageModeBadgeInteractive]}
        >
          <Ionicons
            name={pageMode === 'double' ? 'documents' : 'document'}
            size={14}
            color="#fff"
          />
          <Text style={styles.pageModeBadgeText}>
            {pageMode === 'double' ? '2PG' : '1PG'}
          </Text>
        </TouchableOpacity>
        <View style={styles.orientationBadge}>
          <Ionicons
            name={isLandscape ? 'phone-landscape' : 'phone-portrait'}
            size={14}
            color={isLandscape ? '#fff' : 'rgba(255,255,255,0.4)'}
          />
        </View>

        {onTogglePause && (
          <TouchableOpacity onPress={onTogglePause} style={[styles.pauseBtn, isPaused && styles.pauseBtnActive]}>
            <Ionicons
              name={isPaused ? 'play' : 'pause'}
              size={20}
              color="#fff"
            />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

export const ScannerHeader = React.memo(ScannerHeaderBase);

const styles = StyleSheet.create({
  headerSafeArea: {
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
  },
  phaseTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pageCount: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  pageModeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  pageModeBadgeInteractive: {
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  pageModeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  orientationBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseBtnActive: {
    backgroundColor: COLORS.primary,
  },
});
