import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ScoreItem } from '../../types/review';

interface RubricReviewPanelProps {
  scores: ScoreItem[];
  activeScoreIndex: number;
  feedbackEnabled: boolean;
  onSelectScore: (index: number) => void;
  onImproveAI?: () => void;
  isImprovingAI?: boolean;
}

export function RubricReviewPanel({
  scores,
  activeScoreIndex,
  feedbackEnabled,
  onSelectScore,
  onImproveAI,
  isImprovingAI = false,
}: RubricReviewPanelProps) {
  const activeScore = scores[activeScoreIndex];

  return (
    <View style={styles.container}>
      <View style={styles.questionListPanel}>
        <Text style={styles.sectionTitle}>QUESTIONS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.questionListContent}>
          {scores.map((score, index) => (
            <TouchableOpacity
              key={score.id}
              style={[styles.questionRow, activeScoreIndex === index && styles.activeQuestionRow]}
              onPress={() => onSelectScore(index)}
              activeOpacity={0.8}
            >
              <Text style={[styles.questionNumber, activeScoreIndex === index && styles.activeQuestionNumber]}>
                Q{score.questionNumber}
              </Text>
              <Text style={styles.questionMarks}>
                {score.obtainedMarks} / {score.maxMarks}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.detailPanel}>
        {activeScore ? (
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleGroup}>
                <Text style={styles.sectionTitle}>REVIEWING</Text>
                <Text style={styles.detailTitle}>Question {activeScore.questionNumber}</Text>
              </View>
              <View style={styles.scoreChip}>
                <Text style={styles.scoreChipValue}>{activeScore.obtainedMarks}</Text>
                <Text style={styles.scoreChipMax}>/ {activeScore.maxMarks}</Text>
              </View>
            </View>

            <View style={styles.readingBlock}>
              <Text style={styles.blockLabel}>Question prompt</Text>
              <Text style={styles.questionText}>{activeScore.questionText || 'No question text extracted.'}</Text>
            </View>

            {activeScore.studentAnswerText ? (
              <View style={styles.readingBlock}>
                <Text style={styles.blockLabel}>Student answer</Text>
                <Text style={styles.studentAnswerText}>{activeScore.studentAnswerText}</Text>
              </View>
            ) : null}

            {feedbackEnabled && activeScore.aiFeedback ? (
              <View style={styles.feedbackBox}>
                <View style={styles.feedbackHeader}>
                  <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                  <Text style={styles.feedbackTitle}>AI Evaluation Feedback</Text>
                </View>
                <Text style={styles.feedbackText}>{activeScore.aiFeedback}</Text>
              </View>
            ) : feedbackEnabled ? (
              <View style={styles.feedbackBox}>
                <Text style={styles.feedbackTitle}>AI Evaluation Feedback</Text>
                <Text style={styles.feedbackText}>No AI feedback is available for this question.</Text>
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
            <Text style={styles.feedbackText}>No rubric items found for this paper.</Text>
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
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  questionListContent: {
    gap: 8,
    paddingRight: 16,
  },
  questionRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 104,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activeQuestionRow: {
    backgroundColor: '#FFF7F3',
    borderColor: COLORS.primary,
  },
  questionNumber: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  activeQuestionNumber: {
    color: COLORS.primary,
  },
  questionMarks: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '600',
  },
  detailPanel: {
    backgroundColor: COLORS.backgroundDark,
    flex: 1,
  },
  detailContent: {
    gap: 14,
    padding: 18,
    paddingBottom: 150,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailTitleGroup: {
    flex: 1,
    paddingRight: 14,
  },
  detailTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
  },
  scoreChip: {
    alignItems: 'baseline',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  scoreChipValue: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '900',
  },
  scoreChipMax: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '800',
  },
  readingBlock: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  blockLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  questionText: {
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 25,
  },
  studentAnswerText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
  },
  feedbackBox: {
    backgroundColor: '#FFF8F5',
    borderColor: `${COLORS.primary}24`,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  feedbackHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  feedbackTitle: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  feedbackText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
  },
  improveButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
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
