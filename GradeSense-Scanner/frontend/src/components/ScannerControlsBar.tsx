import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../config';

interface ScannerControlsBarProps {
  autoCropEnabled: boolean;
  autoCaptureEnabled: boolean;
  flashMode: 'off' | 'on' | 'auto';
  onToggleAutoCrop: (val: boolean) => void;
  onToggleAutoCap: (val: boolean) => void;
  onCycleFlash: () => void;
}

const ScannerControlsBarBase: React.FC<ScannerControlsBarProps> = ({
  autoCropEnabled,
  autoCaptureEnabled,
  flashMode,
  onToggleAutoCrop,
  onToggleAutoCap,
  onCycleFlash,
}) => {
  // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
  if (__DEV__) {
    console.log(`[RENDER] ScannerControlsBar: crop=${autoCropEnabled}, cap=${autoCaptureEnabled}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.secondaryHeader}>
      <TouchableOpacity
        style={[styles.smallToggle, autoCropEnabled && styles.smallToggleActive]}
        onPress={() => {
          onToggleAutoCrop(!autoCropEnabled);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <Ionicons name="scan-outline" size={16} color={autoCropEnabled ? '#fff' : COLORS.textMuted} />
        <Text style={[styles.smallToggleText, autoCropEnabled && styles.smallToggleTextActive]}>
          AUTO-CROP
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.smallToggle, autoCaptureEnabled && styles.smallToggleActive]}
        onPress={() => {
          onToggleAutoCap(!autoCaptureEnabled);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <Ionicons name="flash-outline" size={16} color={autoCaptureEnabled ? '#fff' : COLORS.textMuted} />
        <Text style={[styles.smallToggleText, autoCaptureEnabled && styles.smallToggleTextActive]}>
          AUTO-CAP
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.smallToggle} onPress={onCycleFlash}>
        <Ionicons
          name={flashMode === 'on' ? 'flashlight' : flashMode === 'auto' ? 'flash' : 'flash-off'}
          size={16}
          color="#fff"
        />
        <Text style={styles.smallToggleText}>{flashMode.toUpperCase()}</Text>
      </TouchableOpacity>
    </View>
  );
};

export const ScannerControlsBar = React.memo(ScannerControlsBarBase);

const styles = StyleSheet.create({
  secondaryHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  smallToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
    minWidth: 100,
    justifyContent: 'center',
  },
  smallToggleActive: {
    backgroundColor: COLORS.primary,
  },
  smallToggleText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  smallToggleTextActive: {
    color: '#fff',
  },
});
