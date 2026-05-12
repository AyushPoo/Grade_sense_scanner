import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';
import { CaptureState } from '../types';

interface StatusIndicatorProps {
  captureState: CaptureState;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ captureState }) => {
  const { isStable, isDocumentDetected, isSharp } = captureState;

  let guidanceMessage = 'Point at a document';
  let guidanceColor = COLORS.textMuted;
  let iconName = 'scan-outline';

  if (isDocumentDetected) {
    if (!isStable) {
      guidanceMessage = 'Hold steady...';
      guidanceColor = COLORS.warning;
      iconName = 'hand-left-outline';
    } else if (!isSharp) {
      guidanceMessage = 'Focusing...';
      guidanceColor = COLORS.warning;
      iconName = 'eye-outline';
    } else {
      guidanceMessage = 'Ready to capture';
      guidanceColor = COLORS.success;
      iconName = 'checkmark-circle';
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.statusItem}>
        <Ionicons 
          name={iconName as any} 
          size={18} 
          color={guidanceColor} 
        />
        <Text style={[styles.statusText, { color: guidanceColor }]}>
          {guidanceMessage}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginHorizontal: 12,
  },
});
