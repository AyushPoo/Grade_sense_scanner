import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';

interface ProtectedCameraViewProps {
  cameraRef: React.RefObject<any>;
  onCameraReady: () => void;
  // Both required — scanner.tsx passes both correctly.
  // Making them optional caused the memo to miss the isCameraReady=true update.
  isCameraReady: boolean;
  isPaused: boolean;
  flashMode?: 'off' | 'on' | 'auto';
  style?: any;
  children?: React.ReactNode;
}

const ProtectedCameraViewBase: React.FC<ProtectedCameraViewProps> = ({
  cameraRef,
  onCameraReady,
  isCameraReady,
  isPaused,
  flashMode,
  style,
  children,
}) => {
  return (
    // LAYOUT: No cameraHeight prop. Parent controls size.
    // scanner.tsx uses cameraWrapper: { flex: 1 } which fills the space correctly.
    <View style={[styles.cameraContainer, style]}>
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

      {children}
    </View>
  );
};

// React.memo: prevents CameraView reconciliation on CV result state updates.
// Props are primitives + stable refs, so default shallow comparison is correct.
export const ProtectedCameraView = React.memo(ProtectedCameraViewBase);

const styles = StyleSheet.create({
  cameraContainer: {
    // LAYOUT FIX: flex:1 fills parent's available space.
    // The old `height: cameraHeight` was what caused the black screen when
    // scanner.tsx stopped passing cameraHeight.
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
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
