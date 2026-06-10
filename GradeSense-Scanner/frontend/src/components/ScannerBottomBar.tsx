// src/components/ScannerBottomBar.tsx
// FIX: Removed fixed heights, flex-based layout, proper safe area for all Android devices

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureButton } from './CaptureButton';
import { COLORS } from '../config';
import { useHardwareAwareBottomInset } from '../utils/safeArea';

interface ScannerBottomBarProps {
  currentPhase: 'question_paper' | 'model_answer' | 'students';
  isPaused: boolean;
  isCapturing: boolean;
  isCameraReady: boolean;
  currentPagesCount: number;
  autoCaptureEnabled: boolean;
  stabilityProgress: number;
  onTogglePause: () => void;
  onManualCapture: () => void;
  onPickPdf: () => void;
  onSmartScan: () => void;
  onNextStudent: () => void;
  onUndo: () => void;
  onFinishPhase: () => void;
  onFinishSession: () => void;
}

const ScannerBottomBarBase: React.FC<ScannerBottomBarProps> = ({
  currentPhase,
  isPaused,
  isCapturing,
  isCameraReady,
  currentPagesCount,
  autoCaptureEnabled,
  stabilityProgress,
  onTogglePause,
  onManualCapture,
  onSmartScan,
  onNextStudent,
  onUndo,
  onFinishPhase,
  onFinishSession,
}) => {
  if (__DEV__) {
    console.log(`[RENDER] ScannerBottomBar: phase=${currentPhase}, capturing=${isCapturing}`);
  }

  // Use insets directly instead of SafeAreaView wrapper
  // This gives us precise control over bottom padding on every device
  const insets = useSafeAreaInsets();
  const bottomPad = useHardwareAwareBottomInset(insets.bottom, 10);

  const isUndoDisabled = currentPagesCount === 0;

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      {/* Main Action Bar: PAUSE | CAPTURE | NEXT STUDENT */}
      <View style={styles.mainActionBar}>
        <TouchableOpacity
          style={[styles.miniBtn, isPaused && styles.miniBtnActive]}
          onPress={onTogglePause}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={isPaused ? 'play' : 'pause'} size={22} color="#fff" />
          <Text style={styles.miniBtnLabel}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
        </TouchableOpacity>

        <CaptureButton
          onPress={onManualCapture}
          stabilityProgress={isPaused ? 0 : stabilityProgress}
          disabled={isCapturing || isPaused || !isCameraReady}
          autoCaptureEnabled={autoCaptureEnabled && !isPaused && isCameraReady}
        />

        {currentPhase === 'students' ? (
          <TouchableOpacity
            style={styles.nextStudentAction}
            onPress={onNextStudent}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="person-add" size={22} color="#fff" />
            <Text style={styles.nextStudentActionLabel}>NEXT{'\n'}STUDENT</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.miniBtn, isUndoDisabled && styles.undoButtonDisabled]}
            onPress={onUndo}
            disabled={isUndoDisabled}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="arrow-undo"
              size={20}
              color={!isUndoDisabled ? '#fff' : 'rgba(255,255,255,0.3)'}
            />
            <Text style={styles.miniBtnLabel}>UNDO</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Secondary Row: UNDO LAST PAGE | FINISH SESSION */}
      <View style={styles.secondaryRow}>
        {currentPhase !== 'students' ? (
          <View style={styles.documentActionsRow}>
            <TouchableOpacity style={styles.smartScanBtn} onPress={onSmartScan}>
              <Ionicons name="scan" size={16} color={COLORS.primary} />
              <Text style={styles.smartScanBtnText}>SMART SCAN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.donePhaseBtn} onPress={onFinishPhase}>
              <Text style={styles.donePhaseBtnText}>
                FINISH {currentPhase === 'question_paper' ? 'QP' : 'MODEL'}
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.studentActionsRow}>
            <TouchableOpacity
              style={styles.undoStudentBtn}
              onPress={onSmartScan}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="scan" size={16} color={COLORS.primary} />
              <Text style={[styles.undoStudentBtnText, styles.smartStudentText]}>Smart Scan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.undoStudentBtn}
              onPress={onUndo}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-undo" size={16} color="rgba(255,255,255,0.6)" />
              <Text style={styles.undoStudentBtnText}>Undo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.finishSessionBtn} onPress={onFinishSession}>
              <Text style={styles.finishSessionBtnText}>FINISH SESSION</Text>
              <Ionicons name="checkmark-done" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

export const ScannerBottomBar = React.memo(ScannerBottomBarBase);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingTop: 12,
    // No fixed height — grows with content + safe area inset
  },
  mainActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  miniBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  miniBtnActive: {
    backgroundColor: COLORS.primary,
  },
  miniBtnLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  nextStudentAction: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(235,87,34,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(235,87,34,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  nextStudentActionLabel: {
    color: '#FF6B35',
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 11,
  },
  undoButtonDisabled: {
    opacity: 0.4,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 4,
  },
  documentActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  donePhaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 24,
    gap: 10,
  },
  smartScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235,87,34,0.12)',
    borderColor: 'rgba(235,87,34,0.45)',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 24,
    gap: 8,
  },
  smartScanBtnText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  donePhaseBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  studentActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'space-between',
  },
  undoStudentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
  },
  undoStudentBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  smartStudentText: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  finishSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
    gap: 8,
    elevation: 6,
  },
  finishSessionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
