import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { fetchStudentDashboard } from '../../src/api/studentPortal';
import { StudentDashboardData } from '../../src/utils/studentPortalData';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatTile, StatusPill } from '../../src/components/portal/PortalKit';

export default function StudentDashboardScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const user = useAuthStore(state => state.user);
  const router = useRouter();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      setData(await fetchStudentDashboard({ token }));
    } catch (err: any) {
      setError(err.message || 'Student dashboard could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PortalScreen title="Student Home" subtitle={`Welcome${user?.name ? `, ${user.name}` : ''}`} onRefresh={load} refreshing={isLoading}>
      {isLoading && !data ? (
        <PortalState title="Loading student dashboard..." loading />
      ) : error ? (
        <PortalState title="Dashboard unavailable" message={error} onRetry={load} />
      ) : data ? (
        <>
          <View style={styles.statsGrid}>
            <StatTile icon="document-text-outline" label="Exams" value={data.stats.totalExams} />
            <StatTile icon="trending-up-outline" label="Average" value={`${data.stats.avgPercentage}%`} />
            <StatTile icon="sparkles-outline" label="Rank" value={data.stats.rank} />
          </View>

          <PortalCard style={styles.highlight}>
            <Text style={styles.highlightLabel}>Progress</Text>
            <Text style={styles.highlightValue}>{data.stats.improvement >= 0 ? '+' : ''}{data.stats.improvement}%</Text>
            <Text style={styles.highlightCaption}>Compared with recent published results</Text>
          </PortalCard>

          <SectionTitle title="Recent Results" />
          {data.recentResults.length ? data.recentResults.map(result => (
            <PortalCard key={result.submissionId} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{result.examName}</Text>
                <Text style={styles.cardMeta}>{result.subject} - {result.score}</Text>
              </View>
              <View style={styles.rightStack}>
                <StatusPill label={`${result.percentage}%`} tone="success" />
                <PortalActionButton label="Open" icon="open-outline" onPress={() => router.push({ pathname: '/(student)/result-detail', params: { submissionId: result.submissionId, examId: result.examId } } as any)} tone="secondary" />
              </View>
            </PortalCard>
          )) : (
            <PortalState title="No published results yet" message="Your reviewed exam results will appear here once the teacher publishes them." />
          )}

          <SectionTitle title="Subject Performance" />
          {data.subjectPerformance.map(subject => (
            <PortalCard key={subject.subject} style={styles.subjectCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{subject.subject}</Text>
                <Text style={styles.cardMeta}>{subject.exams} exams</Text>
              </View>
              <Text style={styles.percent}>{subject.average}%</Text>
            </PortalCard>
          ))}

          <SectionTitle title="Focus Areas" />
          {[...data.weakAreas, ...data.strongAreas].slice(0, 4).map((area, index) => (
            <PortalCard key={`${area.submissionId}-${area.questionNumber}-${index}`}>
              <Text style={styles.cardTitle}>{area.question}</Text>
              <Text style={styles.cardMeta}>{area.score}</Text>
              {area.feedback ? <Text style={styles.body}>{area.feedback}</Text> : null}
            </PortalCard>
          ))}

          {data.recommendations.length ? (
            <>
              <SectionTitle title="Recommendations" />
              {data.recommendations.map((item, index) => (
                <PortalCard key={`${item}-${index}`}>
                  <Text style={styles.body}>{item}</Text>
                </PortalCard>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  statsGrid: { flexDirection: 'row', gap: 10 },
  highlight: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  highlightLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '700' },
  highlightValue: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  highlightCaption: { color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 4 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  subjectCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  cardMeta: { fontSize: 13, color: COLORS.textMuted, marginTop: 3 },
  rightStack: { gap: 8, alignItems: 'flex-end' },
  percent: { fontSize: 20, fontWeight: '900', color: COLORS.primary },
  body: { fontSize: 14, lineHeight: 20, color: COLORS.textLight },
});
