import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import { REVIEW_DENSITY_OPTIONS, ReviewDensity } from '../../utils/reviewDensity';

interface ReviewDensityControlProps {
  value: ReviewDensity;
  onChange: (value: ReviewDensity) => void;
}

export function ReviewDensityControl({ value, onChange }: ReviewDensityControlProps) {
  return (
    <View style={styles.container} accessibilityRole="adjustable">
      <Ionicons name="text-outline" size={13} color={COLORS.textLight} />
      <View style={styles.options}>
        {REVIEW_DENSITY_OPTIONS.map(option => {
          const isActive = option.value === value;

          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionButton, isActive && styles.activeOptionButton]}
              onPress={() => onChange(option.value)}
              activeOpacity={0.78}
              accessibilityLabel={option.accessibilityLabel}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.optionText, isActive && styles.activeOptionText]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  options: {
    flexDirection: 'row',
    gap: 3,
  },
  optionButton: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 24,
    minWidth: 30,
    paddingHorizontal: 7,
  },
  activeOptionButton: {
    backgroundColor: COLORS.primary,
  },
  optionText: {
    color: COLORS.textLight,
    fontSize: 10,
    fontWeight: '900',
  },
  activeOptionText: {
    color: COLORS.textInverse,
  },
});
