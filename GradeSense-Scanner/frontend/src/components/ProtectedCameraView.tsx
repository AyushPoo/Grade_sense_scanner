import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';

interface ProtectedCameraViewProps {
  cameraRef: React.RefObject<any>;
  onCameraReady: () => void;
  isCameraReady: boolean;
  isPaused: boolean;
  cameraHeight: number;
  flashMode?: 'off' | 'on' | 'auto';
  // Use children to allow Overlay and Status to be placed on top
  children?: React.ReactNode;
}

const ProtectedCameraViewBase: React.FC<ProtectedCameraViewProps> = ({
  cameraRef,
  onCameraReady,
  isCameraReady,
  isPaused,
  cameraHeight,
  flashMode,
  children,
}) => {
  // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
  if (__DEV__) {
    console.log(`[RENDER] ProtectedCameraView: ready=${isCameraReady}, paused=${isPaused}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.cameraContainer, { height: cameraHeight }]}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flashMode}
        onCameraReady={onCameraReady}
      />

      {!isCameraReady && (
        <View style={styles.pauseOverlay}>
          <Ionicons name="camera-outline" size={60} color="rgba(255,255,255,0.8)" />
          <Text style={styles.pauseText}>Initializing Camera...</Text>
        </View>
      )}

      {isPaused && isCameraReady && (
        <View style={styles.pauseOverlay}>
          <Ionicons name="pause-circle" size={80} color="rgba(255,255,255,0.8)" />
          <Text style={styles.pauseText}>PAUSED</Text>
        </View>
      )}

      {/* Children: DocumentContourOverlay, StatusIndicator, etc. */}
      {children}
    </View>
  );
};

// CRITICAL: React.memo here prevents the CameraView from reconciling 
// even if ScannerScreen rerenders due to CV result state updates.
export const ProtectedCameraView = React.memo(ProtectedCameraViewBase);

const styles = StyleSheet.create({
  cameraContainer: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  pauseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
});
