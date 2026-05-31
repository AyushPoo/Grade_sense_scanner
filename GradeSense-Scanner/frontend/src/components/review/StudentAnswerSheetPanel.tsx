import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ReviewFileSlide, ScoreItem } from '../../types/review';

interface Props {
  activeScore: ScoreItem | undefined;
  fileSlides: ReviewFileSlide[];
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

export function StudentAnswerSheetPanel({ activeScore, fileSlides, onOpenFileType }: Props) {
  const hasStudentFile = Boolean(findFile(fileSlides, 'student'));
  const hasQuestionFile = Boolean(findFile(fileSlides, 'question'));
  const hasModelFile = Boolean(findFile(fileSlides, 'model'));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconBox}>
            <Ionicons name="reader-outline" size={20} color={COLORS.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Student Answer Text</Text>
            <Text style={styles.subtitle}>Question {activeScore?.questionNumber || '-'}</Text>
          </View>
        </View>

        {activeScore?.questionText ? (
          <View style={styles.questionBox}>
            <Text style={styles.sectionLabel}>Question</Text>
            <Text style={styles.questionText}>{activeScore.questionText}</Text>
          </View>
        ) : null}

        <View style={styles.answerBox}>
          <Text style={styles.sectionLabel}>Extracted Answer</Text>
          {activeScore?.studentAnswerText ? (
            <Text style={styles.answerText}>{activeScore.studentAnswerText}</Text>
          ) : (
            <Text style={styles.emptyText}>
              Extracted student-answer text is not available for this question yet. You can still open the original paper files below.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.filesCard}>
        <Text style={styles.filesTitle}>Original Paper Files</Text>
        <View style={styles.fileGrid}>
          <FileButton
            icon="document-text-outline"
            label="Answer Sheet"
            disabled={!hasStudentFile}
            onPress={() => onOpenFileType('student')}
          />
          <FileButton
            icon="newspaper-outline"
            label="Question Paper"
            disabled={!hasQuestionFile}
            onPress={() => onOpenFileType('question')}
          />
          <FileButton
            icon="checkmark-done-outline"
            label="Model Answer"
            disabled={!hasModelFile}
            onPress={() => onOpenFileType('model')}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  questionBox: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
  },
  answerBox: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: `${COLORS.primary}22`,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  questionText: {
    color: COLORS.textLight,
    fontSize: 14,
    lineHeight: 21,
  },
  answerText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 23,
  },
  emptyText: {
    color: COLORS.textLight,
    fontSize: 14,
    lineHeight: 21,
  },
  filesCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  filesTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  fileGrid: {
    gap: 10,
  },
  fileButton: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  fileButtonDisabled: {
    opacity: 0.58,
  },
  fileButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  fileButtonTextDisabled: {
    color: COLORS.textMuted,
  },
});
