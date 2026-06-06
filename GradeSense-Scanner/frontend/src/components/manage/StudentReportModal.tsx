import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';

export interface StudentSubjectPerformance {
  subjectName: string;
  examsCount: number;
  averagePercentage: number;
}

export interface StudentExamHistoryItem {
  examId: string;
  examName: string;
  subjectName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  examDate: string | null;
  status: string;
}

export interface ManagedRosterStudent {
  student_id: string;
  name: string;
  roll_number: string;
  email?: string;
  averagePercentage?: number;
  examCount?: number;
  subjectPerformance?: StudentSubjectPerformance[];
  strongSubject?: StudentSubjectPerformance | null;
  weakSubject?: StudentSubjectPerformance | null;
  latestExam?: StudentExamHistoryItem | null;
  examHistory?: StudentExamHistoryItem[];
}

interface StudentReportModalProps {
  student: ManagedRosterStudent | null;
  visible: boolean;
  onClose: () => void;
}

export function StudentReportModal({ student, visible, onClose }: StudentReportModalProps) {
  const subjects = student?.subjectPerformance || [];
  const history = student?.examHistory || [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{student?.name?.[0]?.toUpperCase() || '?'}</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{student?.name || 'Student'}</Text>
              <Text style={styles.subtitle}>
                Roll: {student?.roll_number || 'Not set'}{student?.email ? ` · ${student.email}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.75}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.metrics}>
              <Metric label="Average" value={`${formatPercent(student?.averagePercentage)}%`} />
              <Metric label="Exams" value={String(student?.examCount || history.length || 0)} />
              <Metric label="Latest" value={formatPercent(student?.latestExam?.percentage)} suffix="%" />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Performance Snapshot</Text>
              <SignalRow
                icon="trending-up"
                label="Strength"
                value={student?.strongSubject?.subjectName || 'Needs more graded exams'}
                detail={formatSubjectDetail(student?.strongSubject)}
                tone="success"
              />
              <SignalRow
                icon="alert-circle-outline"
                label="Needs Attention"
                value={student?.weakSubject?.subjectName || 'Needs more graded exams'}
                detail={formatSubjectDetail(student?.weakSubject)}
                tone="warning"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Subject Performance</Text>
              {subjects.length === 0 ? (
                <EmptyRow text="No subject performance is available yet." />
              ) : (
                subjects.map(subject => (
                  <View key={subject.subjectName} style={styles.subjectRow}>
                    <View style={styles.subjectTop}>
                      <Text style={styles.subjectName}>{subject.subjectName}</Text>
                      <Text style={styles.subjectPercent}>{formatPercent(subject.averagePercentage)}%</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.trackFill, { width: `${clampPercent(subject.averagePercentage)}%` }]} />
                    </View>
                    <Text style={styles.subjectMeta}>{subject.examsCount || 0} graded exams</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Exam History</Text>
              {history.length === 0 ? (
                <EmptyRow text="No exam history is synced for this student yet." />
              ) : (
                history.map(item => (
                  <View key={item.examId} style={styles.examRow}>
                    <View style={styles.examIcon}>
                      <Ionicons name="document-text-outline" size={16} color={COLORS.primary} />
                    </View>
                    <View style={styles.examCopy}>
                      <Text style={styles.examName}>{item.examName}</Text>
                      <Text style={styles.examMeta}>
                        {item.subjectName} · {formatDate(item.examDate)}
                      </Text>
                    </View>
                    <View style={styles.examScore}>
                      <Text style={styles.examScoreText}>{formatMarks(item.score)}/{formatMarks(item.totalMarks)}</Text>
                      <Text style={styles.examPercent}>{formatPercent(item.percentage)}%</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Metric({ label, value, suffix = '' }: { label: string; value: string; suffix?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}{suffix}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SignalRow({
  detail,
  icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: 'success' | 'warning';
  value: string;
}) {
  const color = tone === 'success' ? COLORS.success : COLORS.warning;
  const background = tone === 'success' ? COLORS.successLight : COLORS.warningLight;

  return (
    <View style={styles.signalRow}>
      <View style={[styles.signalIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <View style={styles.signalCopy}>
        <Text style={styles.signalLabel}>{label}</Text>
        <Text style={styles.signalValue}>{value}</Text>
        <Text style={styles.signalDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function formatSubjectDetail(subject?: StudentSubjectPerformance | null): string {
  if (!subject) {
    return 'More graded data will make this report useful.';
  }
  return `${formatPercent(subject.averagePercentage)}% average across ${subject.examsCount || 0} exams`;
}

function formatPercent(value?: number | null): string {
  const num = Number(value || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function formatMarks(value?: number | null): string {
  const num = Number(value || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return 'No date';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function clampPercent(value?: number | null): number {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: COLORS.border,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 44,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 10,
    width: 36,
  },
  avatarText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '900',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    padding: 16,
    paddingBottom: 34,
  },
  metrics: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '900',
  },
  metricLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
    textTransform: 'uppercase',
  },
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 15,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 10,
  },
  signalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 10,
  },
  signalIcon: {
    alignItems: 'center',
    borderRadius: 13,
    height: 38,
    justifyContent: 'center',
    marginRight: 10,
    width: 38,
  },
  signalCopy: {
    flex: 1,
  },
  signalLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  signalValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 1,
  },
  signalDetail: {
    color: COLORS.textLight,
    fontSize: 11,
    marginTop: 1,
  },
  subjectRow: {
    marginBottom: 12,
  },
  subjectTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subjectName: {
    color: COLORS.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  subjectPercent: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  track: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 999,
    height: 7,
    overflow: 'hidden',
  },
  trackFill: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    height: '100%',
  },
  subjectMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 5,
  },
  examRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 9,
  },
  examIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 11,
    height: 34,
    justifyContent: 'center',
    marginRight: 10,
    width: 34,
  },
  examCopy: {
    flex: 1,
  },
  examName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  examMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  examScore: {
    alignItems: 'flex-end',
  },
  examScoreText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '900',
  },
  examPercent: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
