import React, { useMemo, useState } from 'react';
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
import {
  getReviewDensityConfig,
  ReviewDensity,
  ReviewDensityConfig,
} from '../../utils/reviewDensity';

interface GradingControlPanelProps {
  activeScore: ScoreItem;
  isSaving: boolean;
  isLastSubmission: boolean;
  density: ReviewDensity;
  onScoreChange: (scoreId: string, obtainedMarks: number) => void;
  onCommentChange: (scoreId: string, comment: string) => void;
  onOpenDictation: () => void;
  onSaveAndNext: () => void;
}

export function GradingControlPanel({
  activeScore,
  isSaving,
  isLastSubmission,
  density,
  onScoreChange,
  onCommentChange,
  onOpenDictation,
  onSaveAndNext,
}: GradingControlPanelProps) {
  const [isNoteEditorVisible, setIsNoteEditorVisible] = useState(false);
  const teacherNote = activeScore.teacherCorrection || '';
  const densityConfig = useMemo(() => getReviewDensityConfig(density), [density]);
  const densityStyles = useMemo(() => createDensityStyles(densityConfig), [densityConfig]);

  const handleSaveNote = (note: string) => {
    onCommentChange(activeScore.id, note);
    setIsNoteEditorVisible(false);
  };

  return (
    <>
      <View style={[styles.panel, densityStyles.panel]}>
        <View style={[styles.stepperRow, densityStyles.stepperRow]}>
          <View style={styles.questionSummary}>
            <Text style={[styles.panelEyebrow, densityStyles.panelEyebrow]}>Current question</Text>
            <Text style={[styles.questionTitle, densityStyles.questionTitle]}>Question {activeScore.questionNumber}</Text>
          </View>

          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={[styles.stepperButton, densityStyles.stepperButton]}
              onPress={() => onScoreChange(activeScore.id, activeScore.obtainedMarks - 0.5)}
              activeOpacity={0.8}
            >
              <Ionicons name="remove" size={densityConfig.stepperIconSize} color={COLORS.primary} />
            </TouchableOpacity>
            <Text style={[styles.stepperValue, densityStyles.stepperValue]}>{activeScore.obtainedMarks.toFixed(1)}</Text>
            <TouchableOpacity
              style={[styles.stepperButton, densityStyles.stepperButton]}
              onPress={() => onScoreChange(activeScore.id, activeScore.obtainedMarks + 0.5)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={densityConfig.stepperIconSize} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.commentLabel, densityStyles.commentLabel]}>Teacher note</Text>
        <View style={[styles.commentRow, densityStyles.commentRow]}>
          <TouchableOpacity
            style={[styles.commentInputContainer, densityStyles.commentInputContainer]}
            onPress={() => setIsNoteEditorVisible(true)}
            activeOpacity={0.78}
          >
            <Text
              style={[styles.commentPreview, densityStyles.commentPreview, !teacherNote && styles.commentPlaceholder]}
              numberOfLines={2}
            >
              {teacherNote || 'Add a short correction or override note...'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.micButton, densityStyles.micButton]} onPress={onOpenDictation} activeOpacity={0.75}>
            <Ionicons name="mic-outline" size={densityConfig.micIconSize} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, densityStyles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={onSaveAndNext}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={densityConfig.saveIconSize} color="#fff" />
              <Text style={[styles.saveButtonText, densityStyles.saveButtonText]}>
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
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  stepperRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  questionSummary: {
    flex: 1,
    paddingRight: 12,
  },
  panelEyebrow: {
    color: COLORS.textMuted,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  questionTitle: {
    color: COLORS.text,
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
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  stepperValue: {
    color: COLORS.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  commentLabel: {
    color: COLORS.textLight,
    fontWeight: '800',
  },
  commentRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  commentInputContainer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
  },
  commentPreview: {
    color: COLORS.text,
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
    justifyContent: 'center',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
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
    fontWeight: '800',
    letterSpacing: 0,
  },
});

function createDensityStyles(config: ReviewDensityConfig) {
  return StyleSheet.create({
    panel: {
      paddingBottom: Platform.OS === 'ios' ? config.footerPaddingBottomIos : config.footerPaddingBottomAndroid,
      paddingHorizontal: config.footerPaddingHorizontal,
      paddingTop: config.footerPaddingTop,
    },
    stepperRow: {
      marginBottom: config.footerGap,
    },
    panelEyebrow: {
      fontSize: config.labelFontSize,
    },
    questionTitle: {
      fontSize: config.footerTitleFontSize,
    },
    stepperButton: {
      height: config.stepperButtonSize,
      width: config.stepperButtonSize,
    },
    stepperValue: {
      fontSize: config.stepperValueFontSize,
      width: config.stepperValueWidth,
    },
    commentLabel: {
      fontSize: config.footerLabelFontSize,
      marginBottom: Math.max(4, config.footerGap - 2),
    },
    commentRow: {
      gap: config.footerGap,
      marginBottom: config.footerGap,
    },
    commentInputContainer: {
      minHeight: config.noteMinHeight,
    },
    commentPreview: {
      fontSize: config.noteFontSize,
      lineHeight: config.noteLineHeight,
      paddingHorizontal: Math.max(8, config.footerPaddingHorizontal - 2),
      paddingVertical: Math.max(6, config.footerPaddingTop),
    },
    micButton: {
      height: config.micButtonSize,
      width: config.micButtonSize,
    },
    saveButton: {
      paddingVertical: config.savePaddingVertical,
    },
    saveButtonText: {
      fontSize: config.saveFontSize,
    },
  });
}
