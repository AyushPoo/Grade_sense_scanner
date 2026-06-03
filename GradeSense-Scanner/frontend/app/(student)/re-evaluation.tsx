import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../src/config';
import { createStudentReEvaluation, fetchStudentReEvaluations, fetchStudentSubmissionDetail, fetchStudentSubmissions } from '../../src/api/studentPortal';
import { StudentSubmissionSummary } from '../../src/utils/studentPortalData';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatusPill } from '../../src/components/portal/PortalKit';

export default function StudentReEvaluationScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const [submissions, setSubmissions] = useState<StudentSubmissionSummary[]>([]);
  const [requests, setRequests] = useState<Record<string, unknown>[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>('');
  const [questionNumbers, setQuestionNumbers] = useState<string[]>([]);
  const [selectedQuestionNumbers, setSelectedQuestionNumbers] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSubmission = useMemo(
    () => submissions.find(item => item.id === selectedSubmissionId),
    [selectedSubmissionId, submissions]
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      const [submissionRows, requestRows] = await Promise.all([
        fetchStudentSubmissions({ token }),
        fetchStudentReEvaluations({ token }),
      ]);
      setSubmissions(submissionRows);
      setRequests(requestRows);
      setSelectedSubmissionId(current => current || submissionRows[0]?.id || '');
    } catch (err: any) {
      setError(err.message || 'Re-evaluation data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    if (!token || !selectedSubmissionId) {
      setQuestionNumbers([]);
      setSelectedQuestionNumbers([]);
      return;
    }

    fetchStudentSubmissionDetail({ token }, selectedSubmissionId)
      .then(detail => {
        if (!active) return;
        const scores = Array.isArray(detail.scores) ? detail.scores : [];
        const nextNumbers = scores
          .map(row => {
            const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
            return String(item.questionNumber ?? item.question_number ?? '').trim();
          })
          .filter(Boolean);
        setQuestionNumbers(nextNumbers);
        setSelectedQuestionNumbers([]);
      })
      .catch(() => {
        if (!active) return;
        setQuestionNumbers([]);
        setSelectedQuestionNumbers([]);
      });

    return () => {
      active = false;
    };
  }, [selectedSubmissionId, token]);

  const submit = async () => {
    if (!token || !selectedSubmission || !selectedQuestionNumbers.length || !reason.trim()) {
      setError('Choose a result, select at least one question, and enter the re-evaluation reason.');
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      await createStudentReEvaluation({ token }, {
        submissionId: selectedSubmission.id,
        questionNumbers: selectedQuestionNumbers,
        reason: reason.trim(),
      });
      setReason('');
      setSelectedQuestionNumbers([]);
      await load();
    } catch (err: any) {
      setError(err.message || 'Unable to submit the re-evaluation request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PortalScreen title="Re-evaluation" subtitle="Request review for published marks" onRefresh={load} refreshing={isLoading}>
      {isLoading && !submissions.length ? (
        <PortalState title="Loading re-evaluations..." loading />
      ) : error ? (
        <PortalState title="Action needed" message={error} onRetry={load} />
      ) : null}

      <SectionTitle title="New Request" />
      <PortalCard style={styles.formCard}>
        <Text style={styles.label}>Select published result</Text>
        <View style={styles.chips}>
          {submissions.map(submission => (
            <TouchableOpacity
              key={submission.id}
              style={[styles.chip, selectedSubmissionId === submission.id && styles.chipActive]}
              onPress={() => setSelectedSubmissionId(submission.id)}
              activeOpacity={0.82}
            >
              <Text style={[styles.chipText, selectedSubmissionId === submission.id && styles.chipTextActive]}>
                {submission.totalScore}/{submission.totalMarks}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Select questions to dispute</Text>
        <View style={styles.chips}>
          {questionNumbers.length ? questionNumbers.map(questionNumber => {
            const active = selectedQuestionNumbers.includes(questionNumber);
            return (
              <TouchableOpacity
                key={questionNumber}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedQuestionNumbers(current => active
                  ? current.filter(item => item !== questionNumber)
                  : [...current, questionNumber])}
                activeOpacity={0.82}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>Q{questionNumber}</Text>
              </TouchableOpacity>
            );
          }) : (
            <Text style={styles.meta}>Question scores are not available for this result yet.</Text>
          )}
        </View>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={setReason}
          placeholder="Explain what should be reviewed..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          textAlignVertical="top"
        />
        <PortalActionButton label="Submit Request" icon="send-outline" onPress={submit} disabled={isSubmitting || !submissions.length || !selectedQuestionNumbers.length} />
      </PortalCard>

      <SectionTitle title="Existing Requests" />
      {requests.length ? requests.map(request => (
        <PortalCard key={String(request.id)}>
          <View style={styles.requestHeader}>
            <Text style={styles.requestTitle}>{String(request.examName ?? request.exam_name ?? 'Re-evaluation')}</Text>
            <StatusPill label={String(request.status ?? 'pending')} tone={String(request.status) === 'resolved' ? 'success' : 'warning'} />
          </View>
          <Text style={styles.meta}>{String(request.reason ?? request.studentReason ?? request.student_reason ?? '')}</Text>
          {request.teacherResponse ? <Text style={styles.response}>{String(request.teacherResponse)}</Text> : null}
        </PortalCard>
      )) : (
        <PortalState title="No re-evaluation requests yet" message="Requests you submit will be tracked here." />
      )}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  formCard: { gap: 12 },
  label: { fontSize: 13, fontWeight: '800', color: COLORS.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryXLight },
  chipText: { fontSize: 13, fontWeight: '800', color: COLORS.textLight },
  chipTextActive: { color: COLORS.primary },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
  },
  requestHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  requestTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: COLORS.text },
  meta: { fontSize: 13, color: COLORS.textLight, lineHeight: 19, marginTop: 8 },
  response: { fontSize: 13, color: COLORS.success, lineHeight: 19, marginTop: 8, fontWeight: '700' },
});
