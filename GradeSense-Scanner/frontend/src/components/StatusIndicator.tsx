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

  const getStatusIcon = (isActive: boolean) => (
    isActive ? 'checkmark-circle' : 'close-circle'
  );

  const getStatusColor = (isActive: boolean) => (
    isActive ? COLORS.success : COLORS.error
  );

  return (
    <View style={styles.container}>
      <View style={styles.statusItem}>
        <Ionicons 
          name={getStatusIcon(isStable)} 
          size={16} 
          color={getStatusColor(isStable)} 
        />
        <Text style={[styles.statusText, { color: getStatusColor(isStable) }]}>
          {isStable ? 'Stable' : 'Moving'}
        </Text>
      </View>
      
      <View style={styles.divider} />
      
      <View style={styles.statusItem}>
        <Ionicons 
          name={getStatusIcon(isSharp)} 
          size={16} 
          color={getStatusColor(isSharp)} 
        />
        <Text style={[styles.statusText, { color: getStatusColor(isSharp) }]}>
          {isSharp ? 'Sharp' : 'Blurry'}
        </Text>
      </View>
      
      <View style={styles.divider} />
      
      <View style={styles.statusItem}>
        <Ionicons 
          name={getStatusIcon(isDocumentDetected)} 
          size={16} 
          color={getStatusColor(isDocumentDetected)} 
        />
        <Text style={[styles.statusText, { color: getStatusColor(isDocumentDetected) }]}>
          {isDocumentDetected ? 'Doc' : 'No Doc'}
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
