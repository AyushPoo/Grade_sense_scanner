import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { fetchStudentSubmissions } from '../../src/api/studentPortal';
import { StudentSubmissionSummary } from '../../src/utils/studentPortalData';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatusPill } from '../../src/components/portal/PortalKit';

export default function StudentResultsScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const router = useRouter();
  const [submissions, setSubmissions] = useState<StudentSubmissionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      setSubmissions(await fetchStudentSubmissions({ token }));
    } catch (err: any) {
      setError(err.message || 'Published results could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PortalScreen title="Results" subtitle="Published marks and teacher feedback" onRefresh={load} refreshing={isLoading}>
      {isLoading && !submissions.length ? (
        <PortalState title="Loading results..." loading />
      ) : error ? (
        <PortalState title="Results unavailable" message={error} onRetry={load} />
      ) : (
        <>
          <SectionTitle title="Published Results" />
          {submissions.length ? submissions.map(submission => (
            <PortalCard key={submission.id} style={styles.card}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Exam Result</Text>
                  <Text style={styles.meta}>{submission.totalScore} / {submission.totalMarks} marks</Text>
                </View>
                <StatusPill label={`${submission.percentage}%`} tone="success" />
              </View>
              {submission.teacherFeedback ? <Text style={styles.feedback}>{submission.teacherFeedback}</Text> : null}
              <PortalActionButton
                label="Review Details"
                icon="open-outline"
                onPress={() => router.push({ pathname: '/(student)/result-detail', params: { submissionId: submission.id, examId: submission.examId } } as any)}
              />
            </PortalCard>
          )) : (
            <PortalState title="No published results yet" message="Once your teacher publishes reviewed marks, they will appear here." />
          )}
        </>
      )}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  meta: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  feedback: { fontSize: 14, color: COLORS.textLight, lineHeight: 20 },
});
