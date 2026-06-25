import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import { ManagedExam } from '../../utils/manageData';

interface Props {
  exams: ManagedExam[];
  isLoading: boolean;
  processingExamId: string | null;
  onReview: (exam: ManagedExam) => void;
  onPublish: (exam: ManagedExam) => void;
  onClose: (exam: ManagedExam) => void;
  onArchive: (exam: ManagedExam) => void;
  onCreateExam: () => void;
  onRetry?: () => void;
  errorMessage?: string | null;
  onAddPapers: (exam: ManagedExam) => void;
  onEditExam: (exam: ManagedExam) => void;
}

function StatusBadge({ exam }: { exam: ManagedExam }) {
  const isPublished = exam.resultsPublished || exam.status === 'published';
  const isClosed = exam.status === 'closed';
  const color = isPublished ? COLORS.success : isClosed ? COLORS.textLight : COLORS.warning;
  const backgroundColor = isPublished ? COLORS.successLight : isClosed ? COLORS.surfaceElevated : COLORS.warningLight;
  const label = isPublished ? 'Published' : isClosed ? 'Closed' : exam.status || 'Graded';

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons name={icon} size={15} color={disabled ? COLORS.textMuted : color} />
      <Text style={[styles.actionText, { color: disabled ? COLORS.textMuted : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ExamCard({
  exam,
  isProcessing,
  onReview,
  onPublish,
  onClose,
  onArchive,
  onAddPapers,
  onEditExam,
}: {
  exam: ManagedExam;
  isProcessing: boolean;
  onReview: (exam: ManagedExam) => void;
  onPublish: (exam: ManagedExam) => void;
  onClose: (exam: ManagedExam) => void;
  onArchive: (exam: ManagedExam) => void;
  onAddPapers: (exam: ManagedExam) => void;
  onEditExam: (exam: ManagedExam) => void;
}) {
  return (
    <View style={styles.examCard}>
      <View style={styles.examHeader}>
        <View style={styles.examIcon}>
          <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
        </View>
        <View style={styles.examTitleBlock}>
          <Text style={styles.examName} numberOfLines={2}>{exam.name}</Text>
          <Text style={styles.examMeta} numberOfLines={1}>
            {exam.subjectName} - {exam.batchName}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            style={styles.gearButton}
            onPress={() => onEditExam(exam)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={18} color={COLORS.textLight} />
          </TouchableOpacity>
          <StatusBadge exam={exam} />
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Submissions" value={exam.submissionCount} />
        <Stat label="Average" value={`${exam.averagePercentage}%`} />
        <Stat label="Marks" value={exam.totalMarks || '-'} />
      </View>

      {exam.examDate && (
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.dateText}>{exam.examDate}</Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        {isProcessing ? (
          <View style={styles.processingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.processingText}>Syncing...</Text>
          </View>
        ) : (
          <>
            <ActionButton icon="create-outline" label="Review" color={COLORS.primary} onPress={() => onReview(exam)} />
            <ActionButton icon="add-circle-outline" label="Add Papers" color={COLORS.primary} onPress={() => onAddPapers(exam)} />
            <ActionButton
              icon="cloud-upload-outline"
              label="Publish"
              color={COLORS.success}
              disabled={exam.resultsPublished}
              onPress={() => onPublish(exam)}
            />
            <ActionButton
              icon="lock-closed-outline"
              label="Close"
              color={COLORS.warning}
              disabled={exam.status === 'closed'}
              onPress={() => onClose(exam)}
            />
            <ActionButton icon="trash-outline" label="Delete" color={COLORS.error} onPress={() => onArchive(exam)} />
          </>
        )}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function ExamManagementPanel({
  exams,
  isLoading,
  processingExamId,
  onReview,
  onPublish,
  onClose,
  onArchive,
  onCreateExam,
  onRetry,
  errorMessage,
  onAddPapers,
  onEditExam,
}: Props) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedBatch, setSelectedBatch] = React.useState('All');
  const [selectedSubject, setSelectedSubject] = React.useState('All');
  const [selectedStatus, setSelectedStatus] = React.useState('All');
  const [sortBy, setSortBy] = React.useState<'date' | 'name' | 'submissions'>('date');

  const uniqueBatches = React.useMemo(() => {
    const set = new Set<string>();
    exams.forEach(e => { if (e.batchName) set.add(e.batchName); });
    return ['All', ...Array.from(set)];
  }, [exams]);

  const uniqueSubjects = React.useMemo(() => {
    const set = new Set<string>();
    exams.forEach(e => { if (e.subjectName) set.add(e.subjectName); });
    return ['All', ...Array.from(set)];
  }, [exams]);

  const filteredExams = React.useMemo(() => {
    let list = [...exams];
    
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => 
        e.name.toLowerCase().includes(q) || 
        (e.subjectName && e.subjectName.toLowerCase().includes(q)) ||
        (e.batchName && e.batchName.toLowerCase().includes(q))
      );
    }
    
    // Batch filter
    if (selectedBatch !== 'All') {
      list = list.filter(e => e.batchName === selectedBatch);
    }
    
    // Subject filter
    if (selectedSubject !== 'All') {
      list = list.filter(e => e.subjectName === selectedSubject);
    }

    // Status filter
    if (selectedStatus !== 'All') {
      list = list.filter(e => {
        const isPublished = e.resultsPublished || e.status === 'published';
        const isClosed = e.status === 'closed';
        if (selectedStatus === 'Published') return isPublished;
        if (selectedStatus === 'Closed') return isClosed;
        if (selectedStatus === 'Graded') return e.status === 'graded' && !isPublished && !isClosed;
        return true;
      });
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'submissions') {
        return (b.submissionCount || 0) - (a.submissionCount || 0);
      }
      // date sorting
      const dateA = a.examDate ? new Date(a.examDate).getTime() : 0;
      const dateB = b.examDate ? new Date(b.examDate).getTime() : 0;
      return dateB - dateA;
    });

    return list;
  }, [exams, searchQuery, selectedBatch, selectedSubject, selectedStatus, sortBy]);

  if (isLoading) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading synced exams...</Text>
      </View>
    );
  }

  if (exams.length === 0) {
    if (errorMessage) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={42} color={COLORS.warning} />
          <Text style={styles.emptyTitle}>Could not load synced exams</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.primaryButton} activeOpacity={0.82} onPress={onRetry}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Ionicons name="school-outline" size={42} color={COLORS.textMuted} />
        <Text style={styles.emptyTitle}>No synced exams found</Text>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.82} onPress={onCreateExam}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.primaryButtonText}>Create Exam</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Synced Exams</Text>
          <Text style={styles.subtitle}>Manage webapp exams from mobile</Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.82} onPress={onCreateExam}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.primaryButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      {/* SEARCH AND FILTERS */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search-outline" size={18} color={COLORS.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search synced exams..."
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Sort Trigger */}
        <TouchableOpacity
          style={styles.sortToggle}
          onPress={() => setSortBy(prev => prev === 'date' ? 'name' : prev === 'name' ? 'submissions' : 'date')}
          activeOpacity={0.8}
        >
          <Ionicons name={sortBy === 'date' ? 'calendar-outline' : sortBy === 'name' ? 'text-outline' : 'list-outline'} size={15} color={COLORS.primary} />
          <Text style={styles.sortToggleText}>
            {sortBy === 'date' ? 'Latest' : sortBy === 'name' ? 'A-Z' : 'Submissions'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* FILTER chips ScrollViews */}
      <View style={styles.filtersContainer}>
        {uniqueBatches.length > 2 && (
          <View style={styles.filterGroup}>
            <Text style={styles.filterGroupLabel}>Batch:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {uniqueBatches.map(batchName => (
                <TouchableOpacity
                  key={batchName}
                  style={[
                    styles.filterChip,
                    selectedBatch === batchName && styles.filterChipActive
                  ]}
                  onPress={() => setSelectedBatch(batchName)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedBatch === batchName && styles.filterChipTextActive
                    ]}
                  >
                    {batchName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {uniqueSubjects.length > 2 && (
          <View style={styles.filterGroup}>
            <Text style={styles.filterGroupLabel}>Subject:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {uniqueSubjects.map(subjName => (
                <TouchableOpacity
                  key={subjName}
                  style={[
                    styles.filterChip,
                    selectedSubject === subjName && styles.filterChipActive
                  ]}
                  onPress={() => setSelectedSubject(subjName)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedSubject === subjName && styles.filterChipTextActive
                    ]}
                  >
                    {subjName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.filterGroup}>
          <Text style={styles.filterGroupLabel}>Status:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            {['All', 'Graded', 'Published', 'Closed'].map(statusName => (
              <TouchableOpacity
                key={statusName}
                style={[
                  styles.filterChip,
                  selectedStatus === statusName && styles.filterChipActive
                ]}
                onPress={() => setSelectedStatus(statusName)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    selectedStatus === statusName && styles.filterChipTextActive
                  ]}
                >
                  {statusName}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* SYNCD EXAMS LIST */}
      {filteredExams.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No matching exams found</Text>
          <Text style={styles.errorText}>Try clearing search queries or filter tags.</Text>
        </View>
      ) : (
        filteredExams.map(exam => (
          <ExamCard
            key={exam.id}
            exam={exam}
            isProcessing={processingExamId === exam.id}
            onReview={onReview}
            onPublish={onPublish}
            onClose={onClose}
            onArchive={onArchive}
            onAddPapers={onAddPapers}
            onEditExam={onEditExam}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 20,
  },
  loadingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  errorText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    maxWidth: 260,
    textAlign: 'center',
  },
  examCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 14,
    gap: 12,
  },
  examHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  examIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryXLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  examName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  examMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '700',
    marginTop: 2,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flexGrow: 1,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundDark,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  processingRow: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
  },
  processingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '700',
  },
  gearButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  sortToggleText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  filtersContainer: {
    gap: 6,
    marginBottom: 4,
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    width: 60,
  },
  filterScroll: {
    paddingRight: 16,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  filterChipTextActive: {
    color: '#fff',
  },
});
