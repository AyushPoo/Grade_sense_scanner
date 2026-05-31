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
}

export function RubricReviewPanel({
  scores,
  activeScoreIndex,
  feedbackEnabled,
  onSelectScore,
}: RubricReviewPanelProps) {
  const activeScore = scores[activeScoreIndex];

  return (
    <View style={styles.container}>
      <View style={styles.questionListPanel}>
        <Text style={styles.sectionTitle}>QUESTIONS</Text>
        <ScrollView contentContainerStyle={styles.questionListContent}>
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
            <Text style={styles.detailTitle}>Question {activeScore.questionNumber}</Text>
            <Text style={styles.questionText}>{activeScore.questionText || 'No question text extracted.'}</Text>

            {activeScore.studentAnswerText ? (
              <View style={styles.studentAnswerBox}>
                <Text style={styles.studentAnswerTitle}>Student Answer</Text>
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
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flex: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  questionListContent: {
    paddingBottom: 12,
  },
  questionRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activeQuestionRow: {
    backgroundColor: `${COLORS.primary}0D`,
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
    backgroundColor: COLORS.cardBg,
    flex: 6,
  },
  detailContent: {
    padding: 16,
    paddingBottom: 24,
  },
  detailTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  questionText: {
    color: COLORS.textLight,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  studentAnswerBox: {
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    padding: 12,
  },
  studentAnswerTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  studentAnswerText: {
    color: COLORS.textLight,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  feedbackBox: {
    backgroundColor: `${COLORS.primary}0D`,
    borderColor: `${COLORS.primary}1A`,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  feedbackHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  feedbackTitle: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  feedbackText: {
    color: COLORS.textLight,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyDetail: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
});
