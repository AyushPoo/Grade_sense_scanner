import React, { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ScoreItem } from '../../types/review';
import { ReviewDensityControl } from './ReviewDensityControl';
import {
  getReviewDensityConfig,
  ReviewDensity,
  ReviewDensityConfig,
} from '../../utils/reviewDensity';

interface RubricReviewPanelProps {
  scores: ScoreItem[];
  activeScoreIndex: number;
  feedbackEnabled: boolean;
  density: ReviewDensity;
  onSelectScore: (index: number) => void;
  onDensityChange: (density: ReviewDensity) => void;
  onFeedbackChange?: (scoreId: string, feedback: string) => void;
  onFeedbackFocus?: () => void;
  onFeedbackBlur?: () => void;
  onImproveAI?: () => void;
  isImprovingAI?: boolean;
  isKeyboardVisible?: boolean;
}

export function RubricReviewPanel({
  scores,
  activeScoreIndex,
  feedbackEnabled,
  density,
  onSelectScore,
  onDensityChange,
  onFeedbackChange,
  onFeedbackFocus,
  onFeedbackBlur,
  onImproveAI,
  isImprovingAI = false,
  isKeyboardVisible = false,
}: RubricReviewPanelProps) {
  const activeScore = scores[activeScoreIndex];
  const densityConfig = useMemo(() => getReviewDensityConfig(density), [density]);
  const densityStyles = useMemo(() => createDensityStyles(densityConfig), [densityConfig]);
  const scrollViewRef = useRef<ScrollView>(null);

  return (
    <View style={styles.container}>
      {!isKeyboardVisible && (
        <View style={[styles.questionListPanel, densityStyles.questionListPanel]}>
          <View style={styles.questionToolbar}>
            <Text style={[styles.sectionTitle, densityStyles.sectionTitle]}>QUESTIONS</Text>
            <ReviewDensityControl value={density} onChange={onDensityChange} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.questionListContent}>
            {scores.map((score, index) => (
              <TouchableOpacity
                key={score.id}
                style={[
                  styles.questionRow,
                  densityStyles.questionRow,
                  activeScoreIndex === index && styles.activeQuestionRow,
                ]}
                onPress={() => onSelectScore(index)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.questionNumber,
                    densityStyles.questionNumber,
                    activeScoreIndex === index && styles.activeQuestionNumber,
                  ]}
                >
                  Q{score.questionNumber}
                </Text>
                <Text style={[styles.questionMarks, densityStyles.questionMarks]}>
                  {score.obtainedMarks} / {score.maxMarks}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.detailPanel}>
        {activeScore ? (
          <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.detailContent, densityStyles.detailContent]}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleGroup}>
                <Text style={[styles.sectionTitle, densityStyles.sectionTitle]}>REVIEWING</Text>
                <Text style={[styles.detailTitle, densityStyles.detailTitle]}>Question {activeScore.questionNumber}</Text>
              </View>
              <View style={[styles.scoreChip, densityStyles.scoreChip]}>
                <Text style={[styles.scoreChipValue, densityStyles.scoreChipValue]}>{activeScore.obtainedMarks}</Text>
                <Text style={[styles.scoreChipMax, densityStyles.scoreChipMax]}>/ {activeScore.maxMarks}</Text>
              </View>
            </View>

            <View style={[styles.readingBlock, densityStyles.readingBlock]}>
              <Text style={[styles.blockLabel, densityStyles.blockLabel]}>Question prompt</Text>
              <Text style={[styles.questionText, densityStyles.bodyText]}>{activeScore.questionText || 'No question text extracted.'}</Text>
            </View>

            {activeScore.studentAnswerText ? (
              <View style={[styles.readingBlock, densityStyles.readingBlock]}>
                <Text style={[styles.blockLabel, densityStyles.blockLabel]}>Student answer</Text>
                <Text style={[styles.studentAnswerText, densityStyles.bodyText]}>{activeScore.studentAnswerText}</Text>
              </View>
            ) : null}

            {feedbackEnabled ? (
              <View style={[styles.feedbackBox, densityStyles.feedbackBox]}>
                <View style={styles.feedbackHeader}>
                  <Ionicons name="sparkles" size={density === 'compact' ? 14 : 16} color={COLORS.primary} />
                  <Text style={[styles.feedbackTitle, densityStyles.feedbackTitle]}>AI Evaluation Feedback</Text>
                  {onFeedbackChange ? <Text style={styles.editableBadge}>Editable</Text> : null}
                </View>
                <TextInput
                  style={[styles.feedbackInput, densityStyles.feedbackInput]}
                  value={activeScore.aiFeedback || ''}
                  onChangeText={feedback => onFeedbackChange?.(activeScore.id, feedback)}
                  placeholder="Add feedback students should see for this question..."
                  placeholderTextColor={COLORS.textMuted}
                  editable={Boolean(onFeedbackChange)}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  onFocus={() => {
                    onFeedbackFocus?.();
                    setTimeout(() => {
                      scrollViewRef.current?.scrollToEnd({ animated: true });
                    }, 150);
                  }}
                  onBlur={onFeedbackBlur}
                />
              </View>
            ) : null}

            {onImproveAI ? (
              <TouchableOpacity
                style={[styles.improveButton, isImprovingAI && styles.improveButtonDisabled]}
                onPress={onImproveAI}
                disabled={isImprovingAI}
                activeOpacity={0.82}
              >
                <Ionicons name="flag-outline" size={16} color={COLORS.primary} />
                <Text style={styles.improveButtonText}>
                  {isImprovingAI ? 'Submitting...' : 'Improve AI'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.emptyDetail}>
            <Text style={[styles.feedbackText, densityStyles.feedbackText]}>No rubric items found for this paper.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  questionListPanel: {
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexGrow: 0,
  },
  questionToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontWeight: '700',
  },
  questionListContent: {
    gap: 7,
    paddingRight: 12,
  },
  questionRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  activeQuestionRow: {
    backgroundColor: '#FFF7F3',
    borderColor: COLORS.primary,
  },
  questionNumber: {
    color: COLORS.text,
    fontWeight: '800',
  },
  activeQuestionNumber: {
    color: COLORS.primary,
  },
  questionMarks: {
    color: COLORS.textLight,
    fontWeight: '600',
  },
  detailPanel: {
    backgroundColor: COLORS.backgroundDark,
    flex: 1,
  },
  detailContent: {
    paddingBottom: 132,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailTitleGroup: {
    flex: 1,
    paddingRight: 10,
  },
  detailTitle: {
    color: COLORS.text,
    fontWeight: '800',
  },
  scoreChip: {
    alignItems: 'baseline',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
  },
  scoreChipValue: {
    color: COLORS.text,
    fontWeight: '900',
  },
  scoreChipMax: {
    color: COLORS.textLight,
    fontWeight: '800',
  },
  readingBlock: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  blockLabel: {
    color: COLORS.textMuted,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  questionText: {
    color: COLORS.text,
  },
  studentAnswerText: {
    color: COLORS.text,
  },
  feedbackBox: {
    backgroundColor: '#FFF8F5',
    borderColor: `${COLORS.primary}24`,
    borderWidth: 1,
  },
  feedbackHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  feedbackTitle: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  feedbackText: {
    color: COLORS.text,
  },
  feedbackInput: {
    color: COLORS.text,
    margin: 0,
    padding: 0,
  },
  editableBadge: {
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 999,
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  improveButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  improveButtonDisabled: {
    opacity: 0.6,
  },
  improveButtonText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyDetail: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
});

function createDensityStyles(config: ReviewDensityConfig) {
  return StyleSheet.create({
    questionListPanel: {
      paddingBottom: config.sectionPaddingVertical,
      paddingHorizontal: config.sectionPaddingHorizontal,
      paddingTop: config.sectionPaddingVertical,
    },
    sectionTitle: {
      fontSize: config.labelFontSize,
      letterSpacing: config.labelLetterSpacing,
      marginBottom: 0,
    },
    questionRow: {
      gap: config.chipGap,
      minWidth: config.chipMinWidth,
      paddingHorizontal: config.chipPaddingHorizontal,
      paddingVertical: config.chipPaddingVertical,
    },
    questionNumber: {
      fontSize: config.questionNumberFontSize,
    },
    questionMarks: {
      fontSize: config.questionMarksFontSize,
    },
    detailContent: {
      gap: config.contentGap,
      padding: config.contentPadding,
      paddingBottom: 132,
    },
    detailTitle: {
      fontSize: config.titleFontSize,
    },
    scoreChip: {
      paddingHorizontal: config.blockPadding,
      paddingVertical: Math.max(6, config.blockPadding - 3),
    },
    scoreChipValue: {
      fontSize: config.scoreValueFontSize,
    },
    scoreChipMax: {
      fontSize: config.scoreMaxFontSize,
    },
    readingBlock: {
      borderRadius: config.blockRadius,
      padding: config.blockPadding,
    },
    blockLabel: {
      fontSize: config.labelFontSize,
      letterSpacing: config.labelLetterSpacing,
      marginBottom: Math.max(5, config.contentGap - 3),
    },
    bodyText: {
      fontSize: config.bodyFontSize,
      lineHeight: config.bodyLineHeight,
    },
    feedbackBox: {
      borderRadius: config.blockRadius,
      padding: config.blockPadding,
    },
    feedbackTitle: {
      fontSize: config.feedbackTitleFontSize,
    },
    feedbackText: {
      fontSize: config.feedbackTextFontSize,
      lineHeight: config.feedbackLineHeight,
    },
    feedbackInput: {
      fontSize: config.feedbackTextFontSize,
      lineHeight: config.feedbackLineHeight,
      minHeight: config.feedbackLineHeight * 2,
    },
  });
}
