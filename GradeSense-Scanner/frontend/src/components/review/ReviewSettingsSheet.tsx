import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import {
  REVIEW_DIFFICULTIES,
  REVIEW_GRADING_MODES,
  ReviewSettings,
} from '../../utils/reviewSettings';

interface ReviewSettingsSheetProps {
  visible: boolean;
  settings: ReviewSettings;
  isFlagging: boolean;
  isSaving: boolean;
  syncStatusText: string;
  onClose: () => void;
  onSave: (settings: ReviewSettings) => void;
  onFlagGrading: () => void;
}

export function ReviewSettingsSheet({
  visible,
  settings,
  isFlagging,
  isSaving,
  syncStatusText,
  onClose,
  onSave,
  onFlagGrading,
}: ReviewSettingsSheetProps) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (visible) {
      setDraft(settings);
    }
  }, [settings, visible]);

  const updateDraft = <K extends keyof ReviewSettings>(key: K, value: ReviewSettings[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Review Settings</Text>
              <Text style={styles.subtitle}>{syncStatusText}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconButton}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>GRADING MODE</Text>
            <View style={styles.modeGrid}>
              {REVIEW_GRADING_MODES.map(mode => {
                const selected = draft.gradingMode === mode.value;
                return (
                  <TouchableOpacity
                    key={mode.value}
                    style={[styles.modeCard, selected && styles.modeCardSelected]}
                    onPress={() => updateDraft('gradingMode', mode.value)}
                    activeOpacity={0.82}
                  >
                    <View style={[styles.modeIcon, selected && styles.modeIconSelected]}>
                      <Ionicons name={mode.icon as any} size={18} color={selected ? '#fff' : COLORS.textLight} />
                    </View>
                    <View style={styles.modeText}>
                      <Text style={[styles.modeLabel, selected && styles.selectedText]}>{mode.label}</Text>
                      <Text style={styles.modeDescription}>{mode.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.rowCard}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Student Feedback</Text>
                <Text style={styles.rowSubtitle}>Show or hide AI feedback while reviewing.</Text>
              </View>
              <Switch
                value={draft.feedbackEnabled}
                onValueChange={value => updateDraft('feedbackEnabled', value)}
                trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                thumbColor={draft.feedbackEnabled ? COLORS.primary : '#f4f3f4'}
              />
            </View>

            <Text style={styles.sectionTitle}>DIFFICULTY</Text>
            <View style={styles.segmentedControl}>
              {REVIEW_DIFFICULTIES.map(option => {
                const selected = draft.difficulty === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.segment, selected && styles.segmentSelected]}
                    onPress={() => updateDraft('difficulty', option.value)}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>CUSTOM INSTRUCTIONS</Text>
            <TextInput
              style={styles.instructionsInput}
              value={draft.customInstructions}
              onChangeText={value => updateDraft('customInstructions', value)}
              placeholder="Add grading guidance for this exam..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
            />

            <TouchableOpacity style={styles.flagButton} onPress={onFlagGrading} disabled={isFlagging}>
              {isFlagging ? (
                <ActivityIndicator size="small" color={COLORS.error} />
              ) : (
                <Ionicons name="flag-outline" size={18} color={COLORS.error} />
              )}
              <Text style={styles.flagText}>Flag AI Grading</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveButton, isSaving && styles.saveButtonDisabled]} onPress={handleSave} disabled={isSaving}>
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: COLORS.border,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 40,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  body: {
    paddingBottom: 18,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 10,
  },
  modeGrid: {
    gap: 8,
  },
  modeCard: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  modeCardSelected: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: COLORS.primary,
  },
  modeIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  modeIconSelected: {
    backgroundColor: COLORS.primary,
  },
  modeText: {
    flex: 1,
  },
  modeLabel: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
  },
  selectedText: {
    color: COLORS.primary,
  },
  modeDescription: {
    color: COLORS.textLight,
    fontSize: 12,
    marginTop: 2,
  },
  rowCard: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    padding: 12,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
  },
  rowSubtitle: {
    color: COLORS.textLight,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  segmentedControl: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    flexDirection: 'row',
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    paddingVertical: 9,
  },
  segmentSelected: {
    backgroundColor: COLORS.cardBg,
  },
  segmentText: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextSelected: {
    color: COLORS.primary,
  },
  instructionsInput: {
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 92,
    padding: 12,
  },
  flagButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingVertical: 8,
  },
  flagText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '800',
  },
  footer: {
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 22,
    paddingTop: 14,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    flex: 1,
    paddingVertical: 13,
  },
  cancelText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '800',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    flex: 1,
    paddingVertical: 13,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  saveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});
