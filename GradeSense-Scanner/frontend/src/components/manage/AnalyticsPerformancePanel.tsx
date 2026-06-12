import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import {
  ManagePerformance,
  QuestionPerformance,
  StudentPerformance,
  SubjectPerformance,
} from '../../utils/manageData';

interface Props {
  performance: ManagePerformance | null;
  isLoading: boolean;
}

function PercentBar({ value, color = COLORS.primary }: { value: number; color?: string }) {
  const width = `${Math.max(0, Math.min(100, value))}%` as DimensionValue;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width, backgroundColor: color }]} />
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyBox}>
      <Ionicons name="analytics-outline" size={22} color={COLORS.textMuted} />
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

function SubjectRow({ item }: { item: SubjectPerformance }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.subjectName}</Text>
        <Text style={styles.rowValue}>{item.averagePercentage}%</Text>
      </View>
      <PercentBar value={item.averagePercentage} />
      <Text style={styles.rowMeta}>{item.examsCount} exams</Text>
    </View>
  );
}

function StudentRow({ item, tone }: { item: StudentPerformance; tone: 'success' | 'warning' }) {
  const color = tone === 'success' ? COLORS.success : COLORS.warning;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.nameBlock}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.studentName}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {item.rollNumber ? `Roll ${item.rollNumber}` : 'No roll number'} {item.examName ? `- ${item.examName}` : ''}
          </Text>
        </View>
        <Text style={[styles.rowValue, { color }]}>{item.percentage}%</Text>
      </View>
      <PercentBar value={item.percentage} color={color} />
    </View>
  );
}

function QuestionRow({ item }: { item: QuestionPerformance }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle} numberOfLines={1}>Q{item.questionNumber || '-'}</Text>
        <Text style={[styles.rowValue, { color: COLORS.error }]}>{item.averagePercentage}%</Text>
      </View>
      {!!item.questionText && <Text style={styles.questionText} numberOfLines={2}>{item.questionText}</Text>}
      <PercentBar value={item.averagePercentage} color={COLORS.error} />
      <Text style={styles.rowMeta}>
        Avg {item.averageScore}/{item.maxMarks} across {item.attempts} attempts
      </Text>
    </View>
  );
}

export function AnalyticsPerformancePanel({ performance, isLoading }: Props) {
  if (isLoading) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading synced insights...</Text>
      </View>
    );
  }

  const data = performance ?? {
    subjectPerformance: [],
    studentRankings: [],
    weakStudents: [],
    weakQuestions: [],
  };

  return (
    <View style={styles.container}>
      <InsightSection title="Subject Performance" icon="book-outline">
        {data.subjectPerformance.length === 0 ? (
          <EmptyState label="No subject performance yet." />
        ) : (
          data.subjectPerformance.map(item => <SubjectRow key={item.subjectName} item={item} />)
        )}
      </InsightSection>

      <InsightSection title="Top Students" icon="trophy-outline">
        {data.studentRankings.length === 0 ? (
          <EmptyState label="No student ranking data yet." />
        ) : (
          data.studentRankings.slice(0, 5).map(item => (
            <StudentRow key={`${item.studentName}-${item.examName}-${item.rollNumber}`} item={item} tone="success" />
          ))
        )}
      </InsightSection>

      <InsightSection title="Needs Attention" icon="alert-circle-outline">
        {data.weakStudents.length === 0 ? (
          <EmptyState label="No weak-student signals yet." />
        ) : (
          data.weakStudents.slice(0, 5).map(item => (
            <StudentRow key={`${item.studentName}-${item.examName}-${item.rollNumber}-weak`} item={item} tone="warning" />
          ))
        )}
      </InsightSection>

      <InsightSection title="Hard Questions" icon="help-circle-outline">
        {data.weakQuestions.length === 0 ? (
          <EmptyState label="No question-level analytics yet." />
        ) : (
          data.weakQuestions.slice(0, 6).map(item => (
            <QuestionRow key={`${item.questionNumber}-${item.questionText}`} item={item} />
          ))
        )}
      </InsightSection>
    </View>
  );
}

function InsightSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={COLORS.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    marginBottom: 24,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 18,
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 14,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  row: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
  },
  rowMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  nameBlock: {
    flex: 1,
    minWidth: 0,
  },
  questionText: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 17,
  },
  barTrack: {
    height: 7,
    backgroundColor: COLORS.borderLight,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingVertical: 16,
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
});
