import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ScoreItem } from '../../types/review';
import { TeacherNoteEditorModal } from './TeacherNoteEditorModal';

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
  const [isNoteEditorVisible, setIsNoteEditorVisible] = useState(false);
  const teacherNote = activeScore.teacherCorrection || '';

  const handleSaveNote = (note: string) => {
    onCommentChange(activeScore.id, note);
    setIsNoteEditorVisible(false);
  };

  return (
    <>
      <View style={styles.panel}>
        <View style={styles.stepperRow}>
          <View style={styles.questionSummary}>
            <Text style={styles.panelEyebrow}>Current question</Text>
            <Text style={styles.questionTitle}>Question {activeScore.questionNumber}</Text>
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

        <Text style={styles.commentLabel}>Teacher note</Text>
        <View style={styles.commentRow}>
          <TouchableOpacity
            style={styles.commentInputContainer}
            onPress={() => setIsNoteEditorVisible(true)}
            activeOpacity={0.78}
          >
            <Text
              style={[styles.commentPreview, !teacherNote && styles.commentPlaceholder]}
              numberOfLines={2}
            >
              {teacherNote || 'Add a short correction or override note...'}
            </Text>
          </TouchableOpacity>
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

      <TeacherNoteEditorModal
        visible={isNoteEditorVisible}
        initialValue={teacherNote}
        questionNumber={activeScore.questionNumber}
        onClose={() => setIsNoteEditorVisible(false)}
        onSave={handleSaveNote}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.cardBg,
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    elevation: 10,
    paddingBottom: Platform.OS === 'ios' ? 14 : 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  stepperRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  questionSummary: {
    flex: 1,
    paddingRight: 12,
  },
  panelEyebrow: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  questionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  stepperContainer: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 3,
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 999,
    elevation: 1,
    height: 30,
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    width: 30,
  },
  stepperValue: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    width: 46,
  },
  commentLabel: {
    color: COLORS.textLight,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
  },
  commentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  commentInputContainer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  commentPreview: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commentPlaceholder: {
    color: COLORS.textMuted,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderColor: `${COLORS.primary}20`,
    borderRadius: 11,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
