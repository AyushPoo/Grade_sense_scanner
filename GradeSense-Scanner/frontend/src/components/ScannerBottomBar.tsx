import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaptureButton } from './CaptureButton';
import { COLORS } from '../config';

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
  onNextStudent,
  onUndo,
  onFinishPhase,
  onFinishSession,
}) => {
  // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
  if (__DEV__) {
    console.log(`[RENDER] ScannerBottomBar: phase=${currentPhase}, capturing=${isCapturing}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const isUndoDisabled = currentPagesCount === 0;

  return (
    <SafeAreaView edges={['bottom']} style={styles.controlsSafeArea}>
      <View style={styles.controlsContainer}>
        {/* Main Action Bar */}
        <View style={styles.mainActionBar}>
          <TouchableOpacity
            style={[styles.miniBtn, isPaused && styles.miniBtnActive]}
            onPress={onTogglePause}
          >
            <Ionicons name={isPaused ? 'play' : 'pause'} size={24} color="#fff" />
            <Text style={styles.miniBtnLabel}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
          </TouchableOpacity>

          <CaptureButton
            onPress={onManualCapture}
            stabilityProgress={isPaused ? 0 : stabilityProgress}
            disabled={isCapturing || isPaused || !isCameraReady}
            autoCaptureEnabled={autoCaptureEnabled && !isPaused && isCameraReady}
          />

          {currentPhase === 'students' ? (
            <TouchableOpacity style={styles.nextStudentAction} onPress={onNextStudent}>
              <Ionicons name="person-add" size={24} color="#fff" />
              <Text style={styles.nextStudentActionLabel}>NEXT STUDENT</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.undoButton, isUndoDisabled && styles.undoButtonDisabled]}
              onPress={onUndo}
              disabled={isUndoDisabled}
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

        {/* Secondary Actions Row */}
        <View style={styles.secondaryActionsRow}>
          {currentPhase !== 'students' ? (
            <TouchableOpacity style={styles.donePhaseBtn} onPress={onFinishPhase}>
              <Text style={styles.donePhaseBtnText}>
                FINISH {currentPhase === 'question_paper' ? 'QP' : 'MODEL'}
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.studentStatsRow}>
              <TouchableOpacity style={styles.undoStudentBtn} onPress={onUndo}>
                <Ionicons name="arrow-undo" size={16} color="rgba(255,255,255,0.6)" />
                <Text style={styles.undoStudentBtnText}>Undo Last Page</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.finishSessionBtn} onPress={onFinishSession}>
                <Text style={styles.finishSessionBtnText}>FINISH SESSION</Text>
                <Ionicons name="checkmark-done" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

export const ScannerBottomBar = React.memo(ScannerBottomBarBase);

const styles = StyleSheet.create({
  controlsSafeArea: {
    backgroundColor: '#000',
  },
  controlsContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  mainActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  miniBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  miniBtnActive: {
    backgroundColor: COLORS.primary,
  },
  miniBtnLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  nextStudentAction: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(235, 87, 34, 0.25)', // Orange tint
    borderWidth: 1,
    borderColor: 'rgba(235, 87, 34, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  nextStudentActionLabel: {
    color: '#FF6B35',
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  undoButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  undoButtonDisabled: {
    opacity: 0.5,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 8,
  },
  donePhaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 10,
  },
  donePhaseBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  studentStatsRow: {
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
  finishSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  finishSessionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
