import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { fetchStudentExamFiles, fetchStudentExams, StudentExamSummary } from '../../src/api/studentPortal';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatusPill } from '../../src/components/portal/PortalKit';

export default function StudentExamsScreen() {
  const router = useRouter();
  const token = useAuthStore(state => state.sessionToken);
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingExamId, setOpeningExamId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      setExams(await fetchStudentExams({ token }));
    } catch (err: any) {
      setError(err.message || 'Assigned exams could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const openQuestionPaper = async (examId: string) => {
    if (!token) return;
    try {
      setOpeningExamId(examId);
      const files = await fetchStudentExamFiles({ token }, examId);
      const url = files.find(file => file.kind === 'question_paper')?.signedUrl || '';
      if (!url) throw new Error('Question paper is not available for this exam yet.');
      await Linking.openURL(url);
    } catch (err: any) {
      setError(err.message || 'Unable to open the question paper.');
    } finally {
      setOpeningExamId(null);
    }
  };

  const startExamSubmission = (examId: string, examName: string) => {
    router.push({
      pathname: '/(student)/submit-exam',
      params: { examId, examName }
    } as any);
  };

  return (
    <PortalScreen title="Assigned Exams" subtitle="Question papers and published result status" onRefresh={load} refreshing={isLoading}>
      {isLoading && !exams.length ? (
        <PortalState title="Loading exams..." loading />
      ) : error ? (
        <PortalState title="Exams unavailable" message={error} onRetry={load} />
      ) : (
        <>
          <SectionTitle title="Exams" />
          {exams.length ? exams.map(exam => (
            <PortalCard key={exam.id} style={styles.examCard}>
              <View style={styles.examHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.examTitle}>{exam.name}</Text>
                  <Text style={styles.meta}>{exam.subjectName} - {exam.totalMarks} marks</Text>
                  {exam.examDate ? <Text style={styles.meta}>{exam.examDate}</Text> : null}
                </View>
                <StatusPill label={exam.resultsPublished ? 'Published' : exam.status} tone={exam.resultsPublished ? 'success' : 'neutral'} />
              </View>
              <PortalActionButton
                label="Open Question Paper"
                icon="document-attach-outline"
                onPress={() => openQuestionPaper(exam.id)}
                tone="secondary"
                disabled={openingExamId === exam.id}
              />
              {!exam.resultsPublished && (
                <PortalActionButton
                  label={exam.status === 'submitted' ? 'Resubmit Answer Sheet' : 'Submit Answer Sheet'}
                  icon="camera-outline"
                  onPress={() => startExamSubmission(exam.id, exam.name)}
                  tone="primary"
                />
              )}
            </PortalCard>
          )) : (
            <PortalState title="No assigned exams" message="Assigned exams from the webapp will appear here." />
          )}
        </>
      )}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  examCard: { gap: 14 },
  examHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  examTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  meta: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
});
