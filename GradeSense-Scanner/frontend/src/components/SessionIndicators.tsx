import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';

interface SessionIndicatorsProps {
  phases: string[];
  currentIndex: number;
}

const SessionIndicatorsBase: React.FC<SessionIndicatorsProps> = ({
  phases,
  currentIndex,
}) => {
  // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
  if (__DEV__) {
    console.log(`[RENDER] SessionIndicators: idx=${currentIndex}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.phaseProgress}>
      {phases.map((phase, idx) => (
        <View key={phase} style={styles.phaseItem}>
          <View style={[
            styles.phaseDot,
            idx === currentIndex && styles.phaseDotActive,
            idx < currentIndex && styles.phaseDotDone,
          ]}>
            {idx < currentIndex && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
          <Text style={[
            styles.phaseLabel,
            idx === currentIndex && styles.phaseLabelActive,
          ]}>{phase}</Text>
        </View>
      ))}
    </View>
  );
};

// Use React.memo with custom comparison for the phases array if needed
// but since we extract it once in parent, it should be stable.
export const SessionIndicators = React.memo(SessionIndicatorsBase);

const styles = StyleSheet.create({
  phaseProgress: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  phaseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phaseDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  phaseDotActive: {
    backgroundColor: '#FFC107',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  phaseDotDone: {
    backgroundColor: '#4CAF50',
  },
  phaseLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  phaseLabelActive: {
    color: '#fff',
  },
});
