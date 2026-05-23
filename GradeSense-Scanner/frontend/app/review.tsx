import React, { useState, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { ScannedStudent, ScannedPage } from '../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 1: Atomic thumbnail cell.
// React.memo at this level ensures the cell never rerenders unless page data
// or onPress reference changes. Memoized at module level — not inside any
// render function — so React preserves the fiber identity permanently.
// ─────────────────────────────────────────────────────────────────────────────
interface ReviewThumbnailItemProps {
  page: ScannedPage;
  pageIndex: number;
  onPress: (pageIndex: number) => void;
}

const ReviewThumbnailItem = memo(({ page, pageIndex, onPress }: ReviewThumbnailItemProps) => {
  // Stable press handler — only recreated if onPress or pageIndex change.
  const handlePress = useCallback(() => onPress(pageIndex), [onPress, pageIndex]);

  return (
    <TouchableOpacity
      style={styles.pageThumb}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {page.file_path ? (
        <Image
          source={{ uri: page.file_path }}
          style={styles.pageThumbImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <View style={styles.pageThumbPlaceholder}>
          <Ionicons name="document" size={24} color={COLORS.textMuted} />
        </View>
      )}
      <View style={styles.pageThumbBadge}>
        <Text style={styles.pageThumbBadgeText}>P{page.page_number}</Text>
      </View>
      {page.is_blurry && (
        <View style={styles.blurryIndicator}>
          <Ionicons name="warning" size={12} color={COLORS.warning} />
        </View>
      )}
    </TouchableOpacity>
  );
});
ReviewThumbnailItem.displayName = 'ReviewThumbnailItem';

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 2: Student card with its own thumbnail FlatList.
// React.memo boundary here is the primary fix: when `previewModal` state
// updates in ReviewScreen, StudentCard will NOT rerender because its props
// (student, isExpanded, onToggle, onPagePress) remain referentially stable.
// ─────────────────────────────────────────────────────────────────────────────
interface StudentCardProps {
  student: ScannedStudent;
  isExpanded: boolean;
  onToggle: (studentIndex: number) => void;
  onPagePress: (student: ScannedStudent, pageIndex: number) => void;
}

const StudentCard = memo(({ student, isExpanded, onToggle, onPagePress }: StudentCardProps) => {
  // Stable toggle handler — derived from stable parent `onToggle` callback.
  const handleToggle = useCallback(
    () => onToggle(student.student_index),
    [onToggle, student.student_index]
  );

  // Stable page-press handler scoped to this student.
  const handlePagePress = useCallback(
    (pageIndex: number) => onPagePress(student, pageIndex),
    [onPagePress, student]
  );

  // Stable renderItem for the thumbnail FlatList.
  // Only recreated when handlePagePress changes (which requires store update).
  const renderThumbnailItem = useCallback(
    ({ item: page, index: pageIdx }: { item: ScannedPage; index: number }) => (
      <ReviewThumbnailItem
        page={page}
        pageIndex={pageIdx}
        onPress={handlePagePress}
      />
    ),
    [handlePagePress]
  );

  return (
    <View style={styles.studentCard}>
      <TouchableOpacity
        style={styles.studentHeader}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        <View style={styles.studentIcon}>
          <Ionicons name="person" size={20} color={COLORS.primary} />
        </View>
        <View style={styles.studentInfo}>
          <Text style={styles.studentName}>{student.label}</Text>
          <Text style={styles.studentMeta}>
            {student.page_count} pages
            {(student.roll_number || student.barcode_data?.data) &&
              ` • Roll: ${student.roll_number || student.barcode_data?.data}`}
          </Text>
        </View>
        <View style={styles.studentStatus}>
          {student.has_blurry_pages ? (
            <Ionicons name="warning" size={18} color={COLORS.warning} />
          ) : (
            <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          )}
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.pagesGrid}>
          {student.pages.length === 0 ? (
            <Text style={styles.noPagesText}>No pages scanned</Text>
          ) : (
            <FlatList
              data={student.pages}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pagesScrollContent}
              keyExtractor={(page) => page.id}
              initialNumToRender={6}
              maxToRenderPerBatch={6}
              windowSize={3}
              // removeClippedSubviews disabled: horizontal strips have few items.
              // Enabling it can cause blank-cell layout bugs on cell recycle.
              removeClippedSubviews={false}
              renderItem={renderThumbnailItem}
            />
          )}
        </View>
      )}
    </View>
  );
});
StudentCard.displayName = 'StudentCard';

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 3: Fullscreen preview modal — completely isolated in its own component.
// Moving the preview FlatList into its own component fiber means React will
// NEVER co-reconcile it with the thumbnail FlatLists. Any state change inside
// PreviewModal stays inside PreviewModal.
// ─────────────────────────────────────────────────────────────────────────────
interface PreviewModalState {
  visible: boolean;
  pages: ScannedPage[];
  currentIndex: number;
  studentLabel: string;
}

interface PreviewModalProps {
  state: PreviewModalState;
  flatListRef: React.RefObject<FlatList | null>;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const PreviewModal = memo(({ state, flatListRef, onClose, onIndexChange }: PreviewModalProps) => {
  // Stable renderItem for the full-screen swipe FlatList.
  const renderPreviewItem = useCallback(
    ({ item }: { item: ScannedPage }) => (
      <View style={styles.modalImageContainer}>
        {item.file_path ? (
          <Image
            source={{ uri: item.file_path }}
            style={styles.modalImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <View style={styles.modalNoImage}>
            <Ionicons name="image-outline" size={64} color={COLORS.textMuted} />
            <Text style={styles.modalNoImageText}>No preview</Text>
          </View>
        )}
      </View>
    ),
    []
  );

  // Stable renderItem for the pagination dot strip.
  // Depends on currentIndex to highlight the active dot.
  const renderPaginationDot = useCallback(
    ({ item, index }: { item: ScannedPage; index: number }) => (
      <TouchableOpacity
        onPress={() => {
          onIndexChange(index);
          flatListRef.current?.scrollToIndex({ index, animated: true });
        }}
        style={[
          styles.paginationDot,
          state.currentIndex === index && styles.paginationDotActive,
        ]}
      />
    ),
    [state.currentIndex, onIndexChange, flatListRef]
  );

  const handleMomentumScrollEnd = useCallback(
    (e: any) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      onIndexChange(index);
    },
    [onIndexChange]
  );

  return (
    <Modal
      visible={state.visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.modalHeaderInfo}>
            <Text style={styles.modalTitle}>
              {state.studentLabel} - Page {state.pages[state.currentIndex]?.page_number}
            </Text>
            <Text style={styles.modalSubtitle}>
              {state.currentIndex + 1} of {state.pages.length}
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {state.pages.length > 1 && (
          <FlatList
            horizontal
            data={state.pages}
            // FIX: Use item.id (UUID) — same key strategy as thumbnail FlatList.
            // Previously used item.ui_id which is regenerated after retakes,
            // causing asymmetric React reconciliation between the two FlatLists.
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modalPagination}
            showsHorizontalScrollIndicator={false}
            renderItem={renderPaginationDot}
          />
        )}

        <FlatList
          ref={flatListRef}
          data={state.pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={state.currentIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          renderItem={renderPreviewItem}
          keyExtractor={(item) => item.id}
        />

        {state.pages.length > 1 && (
          <View style={styles.swipeHint}>
            <Ionicons name="swap-horizontal" size={16} color={COLORS.textMuted} />
            <Text style={styles.swipeHintText}>Swipe to view other pages</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
});
PreviewModal.displayName = 'PreviewModal';

// ─────────────────────────────────────────────────────────────────────────────
// ROOT: ReviewScreen
// Only owns: session data subscription, expand state, preview modal state.
// Student rendering is fully delegated to StudentCard (memoized).
// Preview rendering is fully delegated to PreviewModal (memoized).
// ─────────────────────────────────────────────────────────────────────────────
export default function ReviewScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const savedSessions = useScanStore(state => state.savedSessions);
  const currentSession = useScanStore(state => state.currentSession);

  const session = sessionId
    ? savedSessions.find(s => s.session_id === sessionId) || null
    : currentSession;

  const flatListRef = useRef<FlatList>(null);
  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(new Set());
  const [previewModal, setPreviewModal] = useState<PreviewModalState>({
    visible: false,
    pages: [],
    currentIndex: 0,
    studentLabel: '',
  });

  // ── Stable handlers ────────────────────────────────────────────────────────

  const handleUpload = useCallback(() => {
    if (session) {
      router.push({ pathname: '/upload', params: { sessionId: session.session_id } });
    }
  }, [session, router]);

  // Uses functional updater — does not capture `expandedStudents` in closure.
  const handleToggleStudent = useCallback((studentIndex: number) => {
    setExpandedStudents(prev => {
      const next = new Set(prev);
      if (next.has(studentIndex)) {
        next.delete(studentIndex);
      } else {
        next.add(studentIndex);
      }
      return next;
    });
  }, []);

  // Opens preview for a given student + page. Stable: no deps on other state.
  const handleOpenPagePreview = useCallback((student: ScannedStudent, pageIndex: number) => {
    setPreviewModal({
      visible: true,
      pages: student.pages,
      currentIndex: pageIndex,
      studentLabel: student.label,
    });
  }, []);

  // Uses functional updater — does not capture `previewModal` in closure.
  const handleClosePreview = useCallback(() => {
    setPreviewModal(prev => ({ ...prev, visible: false }));
  }, []);

  // Uses functional updater — does not capture `previewModal` in closure.
  const handlePreviewIndexChange = useCallback((index: number) => {
    setPreviewModal(prev => ({ ...prev, currentIndex: index }));
  }, []);

  // ── Utility ────────────────────────────────────────────────────────────────

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ── Empty state guard ──────────────────────────────────────────────────────

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review Session</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>Session not found</Text>
          <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
            <Text style={styles.goBackBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const studentsWithPages = session.students.filter(s => s.page_count > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Session</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Session Info */}
        <View style={styles.sessionInfo}>
          <Ionicons name="document-text" size={36} color={COLORS.primary} />
          <Text style={styles.sessionName}>{session.session_name}</Text>
          <Text style={styles.batchName}>{session.batch_name}</Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{studentsWithPages.length}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{session.stats.total_pages}</Text>
            <Text style={styles.statLabel}>Pages</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatBytes(session.stats.total_size_bytes)}</Text>
            <Text style={styles.statLabel}>Size</Text>
          </View>
        </View>

        {/* Optional: Question Paper & Model Answer */}
        {(session.question_paper.page_count > 0 || session.model_answer.page_count > 0) && (
          <View style={styles.optionalSection}>
            {session.question_paper.page_count > 0 && (
              <TouchableOpacity style={styles.optionalItem}>
                <Ionicons name="document-text" size={20} color={COLORS.primary} />
                <Text style={styles.optionalText}>
                  Question Paper: {session.question_paper.page_count} pages
                </Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
            {session.model_answer.page_count > 0 && (
              <TouchableOpacity style={styles.optionalItem}>
                <Ionicons name="clipboard" size={20} color={COLORS.success} />
                <Text style={styles.optionalText}>
                  Model Answer: {session.model_answer.page_count} pages
                </Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Students Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>STUDENTS ({studentsWithPages.length})</Text>
          <Text style={styles.sectionHint}>Tap to expand & view pages</Text>
        </View>

        {studentsWithPages.length === 0 ? (
          <View style={styles.noStudents}>
            <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.noStudentsText}>No student papers scanned</Text>
          </View>
        ) : (
          studentsWithPages.map((student) => (
            // StudentCard is React.memo. It will NOT rerender when previewModal
            // state changes, because onToggle and onPagePress are stable callbacks.
            <StudentCard
              key={`student-card-${student.student_index}`}
              student={student}
              isExpanded={expandedStudents.has(student.student_index)}
              onToggle={handleToggleStudent}
              onPagePress={handleOpenPagePreview}
            />
          ))
        )}

        {/* Blurry Pages Warning */}
        {session.stats.blurry_pages > 0 && (
          <View style={styles.warningBox}>
            <Ionicons name="warning" size={20} color={COLORS.warning} />
            <Text style={styles.warningText}>
              {session.stats.blurry_pages} potentially blurry pages detected
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          {(session.status === 'ready' || session.status === 'failed') && (
            <TouchableOpacity style={styles.uploadButton} onPress={handleUpload}>
              <Ionicons name="cloud-upload" size={24} color="#fff" />
              <Text style={styles.uploadButtonText}>UPLOAD TO GRADESENSE</Text>
            </TouchableOpacity>
          )}

          {session.status === 'uploaded' && (
            <View style={styles.uploadedBadge}>
              <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
              <Text style={styles.uploadedText}>Already Uploaded</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.homeButton}
            onPress={() => router.replace('/(tabs)/home')}
          >
            <Ionicons name="home" size={20} color={COLORS.primary} />
            <Text style={styles.homeButtonText}>Back to Home</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* PreviewModal is a React.memo component with its own fiber.
          State changes inside PreviewModal (e.g. currentIndex during swipe)
          are fully isolated — they will NEVER trigger StudentCard rerenders. */}
      <PreviewModal
        state={previewModal}
        flatListRef={flatListRef}
        onClose={handleClosePreview}
        onIndexChange={handlePreviewIndexChange}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 16,
  },
  goBackBtn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  goBackBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  sessionInfo: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  sessionName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
    textAlign: 'center',
  },
  batchName: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  optionalSection: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    marginBottom: 20,
    overflow: 'hidden',
  },
  optionalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  optionalText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  sectionHint: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  noStudents: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    marginBottom: 20,
  },
  noStudentsText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  studentCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  studentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  studentMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  studentStatus: {
    marginRight: 8,
  },
  pagesGrid: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    padding: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  pagesScrollContent: {
    gap: 10,
  },
  noPagesText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  pageThumb: {
    width: 60,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.cardBg,
    position: 'relative',
  },
  pageThumbImage: {
    width: '100%',
    height: '100%',
  },
  pageThumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageThumbBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pageThumbBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  blurryIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 3,
    borderRadius: 4,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: `${COLORS.warning}20`,
    padding: 14,
    borderRadius: 12,
    marginTop: 10,
    marginBottom: 20,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
  },
  actionsContainer: {
    marginTop: 10,
    gap: 12,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 14,
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  uploadedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: `${COLORS.success}15`,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  uploadedText: {
    color: COLORS.success,
    fontSize: 16,
    fontWeight: '600',
  },
  homeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.cardBg,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  homeButtonText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
  },
  modalCloseBtn: {
    padding: 8,
  },
  modalHeaderInfo: {
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  modalPagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    gap: 6,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  paginationDotActive: {
    backgroundColor: COLORS.primary,
    width: 20,
  },
  modalImageContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  modalNoImage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalNoImageText: {
    color: COLORS.textMuted,
    marginTop: 12,
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  swipeHintText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
});
