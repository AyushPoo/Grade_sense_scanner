import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ReviewFileSlide, ScoreItem } from '../../types/review';

interface Props {
  scores: ScoreItem[];
  activeScoreIndex: number;
  fileSlides: ReviewFileSlide[];
  onSelectScore: (index: number) => void;
  onOpenFileType: (type: ReviewFileSlide['type']) => void;
}

function findFile(slides: ReviewFileSlide[], type: ReviewFileSlide['type']) {
  return slides.find(slide => slide.type === type);
}

function FileButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.fileButton, disabled && styles.fileButtonDisabled]}
      activeOpacity={0.82}
      disabled={disabled}
      onPress={onPress}
    >
      <Ionicons name={icon} size={17} color={disabled ? COLORS.textMuted : COLORS.primary} />
      <Text style={[styles.fileButtonText, disabled && styles.fileButtonTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function StudentAnswerSheetPanel({
  scores,
  activeScoreIndex,
  fileSlides,
  onSelectScore,
  onOpenFileType,
}: Props) {
  const hasStudentFile = Boolean(findFile(fileSlides, 'student'));
  const hasQuestionFile = Boolean(findFile(fileSlides, 'question'));
  const hasModelFile = Boolean(findFile(fileSlides, 'model'));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.toolbarCard}>
        <View style={styles.headerRow}>
          <View style={styles.iconBox}>
            <Ionicons name="reader-outline" size={18} color={COLORS.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Student Answers</Text>
            <Text style={styles.subtitle}>Review every question, then open paper files when handwriting needs checking.</Text>
          </View>
        </View>

        <View style={styles.fileActions}>
          <FileButton
            icon="document-text-outline"
            label="Sheet"
            disabled={!hasStudentFile}
            onPress={() => onOpenFileType('student')}
          />
          <FileButton
            icon="newspaper-outline"
            label="Question"
            disabled={!hasQuestionFile}
            onPress={() => onOpenFileType('question')}
          />
          <FileButton
            icon="checkmark-done-outline"
            label="Model"
            disabled={!hasModelFile}
            onPress={() => onOpenFileType('model')}
          />
        </View>
      </View>

      {scores.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="document-outline" size={28} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>No graded questions found for this paper.</Text>
        </View>
      ) : (
        scores.map((score, index) => (
          <TouchableOpacity
            key={score.id}
            style={[styles.questionCard, index === activeScoreIndex && styles.activeQuestionCard]}
            activeOpacity={0.84}
            onPress={() => onSelectScore(index)}
          >
            <View style={styles.questionHeader}>
              <View>
                <Text style={styles.questionNumber}>Question {score.questionNumber}</Text>
                <Text style={styles.questionMarks}>
                  {formatMark(score.obtainedMarks)} / {formatMark(score.maxMarks)} marks
                </Text>
              </View>
              {index === activeScoreIndex ? (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Editing</Text>
                </View>
              ) : null}
            </View>

            {score.questionText ? (
              <View style={styles.promptBlock}>
                <Text style={styles.sectionLabel}>Question prompt</Text>
                <Text style={styles.questionText}>{score.questionText}</Text>
              </View>
            ) : null}

            <View style={[styles.answerBox, !score.studentAnswerText && styles.unstoredAnswerBox]}>
              <Text style={styles.sectionLabel}>Student answer text</Text>
              {score.studentAnswerText ? (
                <Text style={styles.answerText}>{score.studentAnswerText}</Text>
              ) : (
                <Text style={styles.emptyText}>
                  Student-answer text is not stored for this question by the grading backend. Open the paper files above to inspect the original answer.
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  content: {
    gap: 10,
    padding: 12,
    paddingBottom: 24,
  },
  toolbarCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.textLight,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  promptBlock: {
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    marginBottom: 10,
    paddingBottom: 10,
  },
  answerBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  unstoredAnswerBox: {
    backgroundColor: '#FFF8F5',
    borderColor: `${COLORS.primary}22`,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  questionText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 21,
  },
  answerText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 21,
  },
  emptyText: {
    color: COLORS.textLight,
    fontSize: 13,
    lineHeight: 19,
  },
  fileButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  fileButtonDisabled: {
    opacity: 0.58,
  },
  fileButtonText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  fileButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  questionCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  activeQuestionCard: {
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 1,
  },
  questionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  questionNumber: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  questionMarks: {
    color: COLORS.textLight,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeBadgeText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '900',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
});
