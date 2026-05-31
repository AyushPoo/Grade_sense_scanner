import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ScoreItem } from '../../types/review';

interface GradingControlPanelProps {
  activeScore: ScoreItem;
  isSaving: boolean;
  isLastSubmission: boolean;
  onScoreChange: (scoreId: string, obtainedMarks: number) => void;
  onCommentChange: (scoreId: string, comment: string) => void;
  onOpenDictation: () => void;
  onSaveAndNext: () => void;
}

export function GradingControlPanel({
  activeScore,
  isSaving,
  isLastSubmission,
  onScoreChange,
  onCommentChange,
  onOpenDictation,
  onSaveAndNext,
}: GradingControlPanelProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'position' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
    >
      <View style={styles.panel}>
        <View style={styles.stepperRow}>
          <View style={styles.questionSummary}>
            <Text style={styles.questionTitle}>Question {activeScore.questionNumber}</Text>
            <Text style={styles.questionMax}>Max Marks: {activeScore.maxMarks}</Text>
          </View>

          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => onScoreChange(activeScore.id, activeScore.obtainedMarks - 0.5)}
              activeOpacity={0.8}
            >
              <Ionicons name="remove" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{activeScore.obtainedMarks.toFixed(1)}</Text>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => onScoreChange(activeScore.id, activeScore.obtainedMarks + 0.5)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.commentRow}>
          <View style={styles.commentInputContainer}>
            <TextInput
              style={styles.commentInput}
              value={activeScore.teacherCorrection || ''}
              onChangeText={value => onCommentChange(activeScore.id, value)}
              placeholder="Add custom marks override comment..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
            />
          </View>
          <TouchableOpacity style={styles.micButton} onPress={onOpenDictation} activeOpacity={0.75}>
            <Ionicons name="mic-outline" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={onSaveAndNext}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={22} color="#fff" />
              <Text style={styles.saveButtonText}>
                {isLastSubmission ? 'APPROVE & FINISH' : 'APPROVE & NEXT STUDENT'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.cardBg,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    elevation: 10,
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  stepperRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  questionSummary: {
    flex: 1,
  },
  questionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  questionMax: {
    color: COLORS.textLight,
    fontSize: 12,
    marginTop: 2,
  },
  stepperContainer: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    elevation: 1,
    height: 40,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    width: 40,
  },
  stepperValue: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    width: 50,
  },
  commentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  commentInputContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
  },
  commentInput: {
    color: COLORS.text,
    fontSize: 14,
    maxHeight: 96,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderColor: `${COLORS.primary}20`,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
