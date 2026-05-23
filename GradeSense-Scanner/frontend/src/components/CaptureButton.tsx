import React from 'react';
import { TouchableOpacity, View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { 
  useAnimatedStyle, 
  withSpring,
  useSharedValue,
} from 'react-native-reanimated';
import { COLORS } from '../config';

interface CaptureButtonProps {
  onPress: () => void;
  stabilityProgress: number;
  disabled?: boolean;
  autoCaptureEnabled?: boolean;
}

// ── PHASE 4 FIX: React.memo wrapper — CaptureButton will not re-render when ScannerScreen
// re-renders for unrelated reasons (e.g. cvResult update, workflowState change).
// Re-renders only when its own props change: onPress, stabilityProgress, disabled, autoCaptureEnabled.
const CaptureButtonBase = ({
  onPress,
  stabilityProgress,
  disabled,
  autoCaptureEnabled,
}: CaptureButtonProps) => {
  const scale = useSharedValue(1);

  const handlePressIn = () => {
    scale.value = withSpring(0.95);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const progressDegrees = stabilityProgress * 360;

  return (
    <Animated.View style={animatedStyle}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        activeOpacity={0.8}
        style={[styles.container, disabled && styles.disabled]}
      >
        {/* Progress ring */}
        {autoCaptureEnabled && stabilityProgress > 0 && (
          <View style={styles.progressRing}>
            <View 
              style={[
                styles.progressArc,
                { 
                  borderColor: COLORS.success,
                  transform: [{ rotate: `${progressDegrees}deg` }],
                },
              ]} 
            />
          </View>
        )}
        
        {/* Main button */}
        <View style={styles.outerRing}>
          <View style={styles.innerCircle}>
            <Ionicons name="camera" size={32} color="#fff" />
          </View>
        </View>
        
        {/* Label */}
        <Text style={styles.label}>CAPTURE</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const CaptureButton = React.memo(CaptureButtonBase);
CaptureButton.displayName = 'CaptureButton';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  progressRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressArc: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: COLORS.success,
  },
  outerRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  innerCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 1,
  },
});
