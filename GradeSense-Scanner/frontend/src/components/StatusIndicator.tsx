/**
 * StatusIndicator — Adobe-style 5-state scan status pill
 *
 * States:
 *   searching  — no document in frame
 *   detected   — document found, not stable enough
 *   holding    — stable + ready, auto-capture imminent
 *   capturing  — shutter in flight
 *   saved      — page persisted successfully
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CaptureState } from '../types';

// ─── LiveScanStatus ───────────────────────────────────────────────────────────

export type LiveScanStatus =
  | 'searching'
  | 'detected'
  | 'holding'
  | 'capturing'
  | 'saved';

// ─── State config table ───────────────────────────────────────────────────────

interface StatusConfig {
  label: string;
  color: string;
  icon: string;
  bgColor: string;
}

const STATUS_CONFIG: Record<LiveScanStatus, StatusConfig> = {
  searching: {
    label: 'Searching...',
    color: '#AAAAAA',
    icon: 'scan-outline',
    bgColor: 'rgba(0,0,0,0.60)',
  },
  detected: {
    label: 'Document Detected',
    color: '#FFC107',
    icon: 'document-outline',
    bgColor: 'rgba(40,28,0,0.78)',
  },
  holding: {
    label: 'Hold Steady...',
    color: '#FFD54F',
    icon: 'hand-left-outline',
    bgColor: 'rgba(40,28,0,0.78)',
  },
  capturing: {
    label: 'Capturing...',
    color: '#FF6B35',
    icon: 'camera',
    bgColor: 'rgba(50,15,0,0.85)',
  },
  saved: {
    label: 'Saved  ✓',
    color: '#4CAF50',
    icon: 'checkmark-circle',
    bgColor: 'rgba(0,35,0,0.80)',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface StatusIndicatorProps {
  captureState: CaptureState;
  liveScanStatus?: LiveScanStatus;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  captureState: _captureState, // kept for API compatibility — UI now driven by liveScanStatus
  liveScanStatus = 'searching',
}) => {
  const cfg = STATUS_CONFIG[liveScanStatus];

  return (
    <View style={[styles.container, { backgroundColor: cfg.bgColor }]}>
      <View style={styles.statusItem}>
        <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
        <Text style={[styles.statusText, { color: cfg.color }]}>
          {cfg.label}
        </Text>
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
