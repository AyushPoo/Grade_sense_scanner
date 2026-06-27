import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, TextInput, ScrollView, Modal, Dimensions } from 'react-native';
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
  onExport: (exam: ManagedExam) => void;
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
  onExport,
}: {
  exam: ManagedExam;
  isProcessing: boolean;
  onReview: (exam: ManagedExam) => void;
  onPublish: (exam: ManagedExam) => void;
  onClose: (exam: ManagedExam) => void;
  onArchive: (exam: ManagedExam) => void;
  onAddPapers: (exam: ManagedExam) => void;
  onEditExam: (exam: ManagedExam) => void;
  onExport: (exam: ManagedExam) => void;
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
              icon="share-social-outline"
              label="Export & Share"
              color={COLORS.primary}
              onPress={() => onExport(exam)}
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
  onExport,
}: Props) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedBatch, setSelectedBatch] = React.useState('All');
  const [selectedSubject, setSelectedSubject] = React.useState('All');
  const [selectedStatus, setSelectedStatus] = React.useState('All');
  const [sortBy, setSortBy] = React.useState<'date' | 'name' | 'submissions'>('date');

  const [showFiltersModal, setShowFiltersModal] = React.useState(false);
  const [activeFilterCategory, setActiveFilterCategory] = React.useState<'batch' | 'subject' | 'status'>('batch');
  const [tempBatch, setTempBatch] = React.useState('All');
  const [tempSubject, setTempSubject] = React.useState('All');
  const [tempStatus, setTempStatus] = React.useState('All');

  const openFilters = () => {
    setTempBatch(selectedBatch);
    setTempSubject(selectedSubject);
    setTempStatus(selectedStatus);
    setShowFiltersModal(true);
  };

  const applyFilters = () => {
    setSelectedBatch(tempBatch);
    setSelectedSubject(tempSubject);
    setSelectedStatus(tempStatus);
    setShowFiltersModal(false);
  };

  const clearTempFilters = () => {
    setTempBatch('All');
    setTempSubject('All');
    setTempStatus('All');
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (selectedBatch !== 'All') count++;
    if (selectedSubject !== 'All') count++;
    if (selectedStatus !== 'All') count++;
    return count;
  };

  const tempFilteredExamsCount = React.useMemo(() => {
    let list = [...exams];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.subjectName && e.subjectName.toLowerCase().includes(q)) ||
        (e.batchName && e.batchName.toLowerCase().includes(q))
      );
    }
    if (tempBatch !== 'All') {
      list = list.filter(e => e.batchName === tempBatch);
    }
    if (tempSubject !== 'All') {
      list = list.filter(e => e.subjectName === tempSubject);
    }
    if (tempStatus !== 'All') {
      list = list.filter(e => {
        if (tempStatus === 'Graded') return e.status === 'graded';
        if (tempStatus === 'Published') return e.status === 'published';
        if (tempStatus === 'Closed') return e.status === 'closed';
        return true;
      });
    }
    return list.length;
  }, [exams, searchQuery, tempBatch, tempSubject, tempStatus]);

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

        {/* Filters Trigger */}
        <TouchableOpacity
          style={[
            styles.sortToggle,
            getActiveFiltersCount() > 0 && styles.filterToggleActive
          ]}
          onPress={openFilters}
          activeOpacity={0.8}
        >
          <Ionicons 
            name="funnel-outline" 
            size={15} 
            color={getActiveFiltersCount() > 0 ? COLORS.primary : COLORS.textMuted} 
          />
          <Text 
            style={[
              styles.sortToggleText,
              { color: getActiveFiltersCount() > 0 ? COLORS.primary : COLORS.textMuted }
            ]}
          >
            {getActiveFiltersCount() > 0 ? `Filters (${getActiveFiltersCount()})` : 'Filters'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* FILTERS MODAL */}
      <Modal
        visible={showFiltersModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFiltersModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={() => setShowFiltersModal(false)} style={styles.backButton}>
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Filters</Text>
              </View>
              {(tempBatch !== 'All' || tempSubject !== 'All' || tempStatus !== 'All') && (
                <TouchableOpacity onPress={clearTempFilters}>
                  <Text style={styles.clearAllText}>Clear Filters</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Split Content */}
            <View style={styles.splitContent}>
              {/* Left Column: Categories List */}
              <View style={styles.leftColumn}>
                <TouchableOpacity
                  style={[styles.categoryTab, activeFilterCategory === 'batch' && styles.categoryTabActive]}
                  onPress={() => setActiveFilterCategory('batch')}
                >
                  <Text style={[styles.categoryText, activeFilterCategory === 'batch' && styles.categoryTextActive]}>
                    Batch {tempBatch !== 'All' ? '•' : ''}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.categoryTab, activeFilterCategory === 'subject' && styles.categoryTabActive]}
                  onPress={() => setActiveFilterCategory('subject')}
                >
                  <Text style={[styles.categoryText, activeFilterCategory === 'subject' && styles.categoryTextActive]}>
                    Subject {tempSubject !== 'All' ? '•' : ''}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.categoryTab, activeFilterCategory === 'status' && styles.categoryTabActive]}
                  onPress={() => setActiveFilterCategory('status')}
                >
                  <Text style={[styles.categoryText, activeFilterCategory === 'status' && styles.categoryTextActive]}>
                    Status {tempStatus !== 'All' ? '•' : ''}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Right Column: Options List */}
              <ScrollView style={styles.rightColumn} contentContainerStyle={styles.rightColumnContent}>
                {activeFilterCategory === 'batch' && uniqueBatches.map(batchName => (
                  <TouchableOpacity
                    key={batchName}
                    style={styles.optionItem}
                    onPress={() => setTempBatch(batchName)}
                  >
                    <View style={[styles.radioOuter, tempBatch === batchName && styles.radioOuterSelected]}>
                      {tempBatch === batchName && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.optionText, tempBatch === batchName && styles.optionTextSelected]}>
                      {batchName}
                    </Text>
                  </TouchableOpacity>
                ))}

                {activeFilterCategory === 'subject' && uniqueSubjects.map(subjName => (
                  <TouchableOpacity
                    key={subjName}
                    style={styles.optionItem}
                    onPress={() => setTempSubject(subjName)}
                  >
                    <View style={[styles.radioOuter, tempSubject === subjName && styles.radioOuterSelected]}>
                      {tempSubject === subjName && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.optionText, tempSubject === subjName && styles.optionTextSelected]}>
                      {subjName}
                    </Text>
                  </TouchableOpacity>
                ))}

                {activeFilterCategory === 'status' && ['All', 'Graded', 'Published', 'Closed'].map(statusName => (
                  <TouchableOpacity
                    key={statusName}
                    style={styles.optionItem}
                    onPress={() => setTempStatus(statusName)}
                  >
                    <View style={[styles.radioOuter, tempStatus === statusName && styles.radioOuterSelected]}>
                      {tempStatus === statusName && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.optionText, tempStatus === statusName && styles.optionTextSelected]}>
                      {statusName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Bottom Actions */}
            <View style={styles.bottomActions}>
              <Text style={styles.resultsText}>
                {tempFilteredExamsCount} {tempFilteredExamsCount === 1 ? 'exam' : 'exams'} found
              </Text>
              <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
                <Text style={styles.applyButtonText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
            onExport={onExport}
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
  filterToggleActive: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: COLORS.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    height: Dimensions.get('window').height * 0.75,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  splitContent: {
    flex: 1,
    flexDirection: 'row',
  },
  leftColumn: {
    width: '35%',
    backgroundColor: '#F0F2F5',
    borderRightWidth: 1,
    borderRightColor: COLORS.borderLight,
  },
  categoryTab: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  categoryTabActive: {
    backgroundColor: COLORS.background,
    borderLeftColor: COLORS.primary,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  categoryTextActive: {
    fontWeight: '700',
    color: COLORS.primary,
  },
  rightColumn: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  rightColumnContent: {
    paddingVertical: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: COLORS.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  optionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
  },
  resultsText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  applyButton: {
    backgroundColor: '#FB641B', // Flipkart orange
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 32,
  },
  applyButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
