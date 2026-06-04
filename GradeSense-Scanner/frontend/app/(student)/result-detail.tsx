import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/config';
import { fetchStudentExamFiles, fetchStudentSubmissionDetail, StudentExamFile } from '../../src/api/studentPortal';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatusPill } from '../../src/components/portal/PortalKit';

interface QuestionResult {
  id: string;
  label: string;
  questionText: string;
  score: number;
  maxMarks: number;
  feedback: string | null;
  feedbackSource: 'teacher' | 'ai' | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readQuestionFeedback(item: Record<string, unknown>): Pick<QuestionResult, 'feedback' | 'feedbackSource'> {
  const teacherFeedback = asNonEmptyString(
    item.teacherCorrection
      ?? item.teacher_correction
      ?? item.teacherFeedback
      ?? item.teacher_feedback
  );

  if (teacherFeedback) {
    return { feedback: teacherFeedback, feedbackSource: 'teacher' };
  }

  const aiFeedback = asNonEmptyString(item.feedback ?? item.aiFeedback ?? item.ai_feedback);
  return aiFeedback
    ? { feedback: aiFeedback, feedbackSource: 'ai' }
    : { feedback: null, feedbackSource: null };
}

function normalizeQuestions(detail: Record<string, unknown>): QuestionResult[] {
  const rows = Array.isArray(detail.scores)
    ? detail.scores
    : Array.isArray(detail.questions)
      ? detail.questions
      : Array.isArray(detail.questionResults)
        ? detail.questionResults
        : [];
  return rows.map((row, index) => {
    const item = asRecord(row);
    const feedback = readQuestionFeedback(item);
    return {
      id: String(item.id ?? item.questionId ?? index),
      label: String(item.questionNumber ?? item.question_number ?? `Q${index + 1}`),
      questionText: String(item.questionText ?? item.question_text ?? item.prompt ?? ''),
      score: Number(item.score ?? item.obtainedMarks ?? item.obtained_marks ?? item.awardedMarks ?? item.awarded_marks ?? 0),
      maxMarks: Number(item.maxMarks ?? item.max_marks ?? 0),
      ...feedback,
    };
  });
}

export default function StudentResultDetailScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const router = useRouter();
  const params = useLocalSearchParams<{ submissionId?: string; examId?: string }>();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [examFiles, setExamFiles] = useState<StudentExamFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !params.submissionId) return;
    try {
      setError(null);
      setIsLoading(true);
      const submission = await fetchStudentSubmissionDetail({ token }, params.submissionId);
      setDetail(submission);
      const nestedSubmission = asRecord(submission.submission);
      const examId = params.examId || String(submission.examId ?? submission.exam_id ?? nestedSubmission.examId ?? nestedSubmission.exam_id ?? '');
      if (examId) {
        setExamFiles(await fetchStudentExamFiles({ token }, examId));
      }
    } catch (err: any) {
      setError(err.message || 'Result details could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [params.examId, params.submissionId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const questions = useMemo(() => (detail ? normalizeQuestions(detail) : []), [detail]);
  const nestedSubmission = asRecord(detail?.submission);
  const score = Number(detail?.totalScore ?? detail?.total_score ?? nestedSubmission.totalScore ?? nestedSubmission.total_score ?? 0);
  const totalMarks = Number(detail?.totalMarks ?? detail?.total_marks ?? nestedSubmission.totalMarks ?? nestedSubmission.total_marks ?? 0);

  const openFile = async (key: string) => {
    const submissionFiles = Array.isArray(detail?.files) ? detail.files as Record<string, unknown>[] : [];
    const url = key === 'answerSheet'
      ? String(submissionFiles.find(file => file.signedUrl || file.signed_url)?.signedUrl ?? submissionFiles.find(file => file.signedUrl || file.signed_url)?.signed_url ?? '')
      : examFiles.find(file => file.kind === key)?.signedUrl || '';
    if (!url) {
      setError('This paper file is not available yet.');
      return;
    }
    await Linking.openURL(url);
  };

  return (
    <PortalScreen title="Result Details" subtitle="Question feedback and files" onRefresh={load} refreshing={isLoading}>
      <PortalActionButton label="Back to Results" icon="arrow-back" onPress={() => router.back()} tone="secondary" />
      {isLoading && !detail ? (
        <PortalState title="Loading result..." loading />
      ) : error ? (
        <PortalState title="Result unavailable" message={error} onRetry={load} />
      ) : detail ? (
        <>
          <PortalCard style={styles.scoreCard}>
            <View>
              <Text style={styles.scoreLabel}>Total Score</Text>
              <Text style={styles.scoreValue}>{score} / {totalMarks}</Text>
            </View>
            <StatusPill label={`${Number(detail.percentage ?? 0)}%`} tone="success" />
          </PortalCard>

          <SectionTitle title="Paper Files" />
          <View style={styles.actions}>
            <PortalActionButton label="Answer Sheet" icon="document-outline" onPress={() => openFile('answerSheet')} tone="secondary" />
            <PortalActionButton label="Question Paper" icon="newspaper-outline" onPress={() => openFile('question_paper')} tone="secondary" />
            <PortalActionButton label="Model Answer" icon="checkmark-done-outline" onPress={() => openFile('model_answer')} tone="secondary" />
          </View>

          <SectionTitle title="Question Feedback" />
          {questions.length ? questions.map(question => (
            <PortalCard key={question.id} style={styles.questionCard}>
              <View style={styles.questionHeader}>
                <Text style={styles.questionTitle}>{question.label}</Text>
                <Text style={styles.questionScore}>{question.score} / {question.maxMarks}</Text>
              </View>
              {question.questionText ? <Text style={styles.prompt}>{question.questionText}</Text> : null}
              {question.feedback ? (
                <View style={styles.feedbackBox}>
                  <Ionicons
                    name={question.feedbackSource === 'teacher' ? 'chatbubble-ellipses-outline' : 'sparkles-outline'}
                    size={15}
                    color={COLORS.primary}
                  />
                  <View style={styles.feedbackContent}>
                    <Text style={styles.feedbackLabel}>
                      {question.feedbackSource === 'teacher' ? 'Teacher feedback' : 'AI feedback'}
                    </Text>
                    <Text style={styles.feedback}>{question.feedback}</Text>
                  </View>
                </View>
              ) : null}
            </PortalCard>
          )) : (
            <PortalState title="No question feedback found" message="Published question-level feedback will appear here when available." />
          )}
        </>
      ) : null}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  scoreCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreLabel: { fontSize: 13, color: COLORS.textMuted, fontWeight: '700' },
  scoreValue: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginTop: 4 },
  actions: { gap: 10 },
  questionCard: { gap: 12 },
  questionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  questionTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  questionScore: { fontSize: 16, fontWeight: '900', color: COLORS.primary },
  prompt: { fontSize: 14, color: COLORS.text, lineHeight: 20 },
  feedbackBox: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: COLORS.primaryXLight },
  feedbackContent: { flex: 1, gap: 4 },
  feedbackLabel: { fontSize: 11, color: COLORS.primary, fontWeight: '900', textTransform: 'uppercase' },
  feedback: { flex: 1, fontSize: 13, color: COLORS.textLight, lineHeight: 19 },
});
