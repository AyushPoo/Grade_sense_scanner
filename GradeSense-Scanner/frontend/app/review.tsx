import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  Modal,
  FlatList,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { ScanSession, ScannedStudent, ScannedPage } from '../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ReviewScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { savedSessions, currentSession, removePage } = useScanStore();
  
  const [session, setSession] = useState<ScanSession | null>(null);
  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(new Set());
  const [previewModal, setPreviewModal] = useState<{
    visible: boolean;
    pages: ScannedPage[];
    currentIndex: number;
    studentLabel: string;
  }>({ visible: false, pages: [], currentIndex: 0, studentLabel: '' });

  useEffect(() => {
    if (sessionId) {
      const found = savedSessions.find(s => s.session_id === sessionId);
      if (found) {
        setSession(found);
      }
    } else if (currentSession) {
      setSession(currentSession);
    }
  }, [sessionId, savedSessions, currentSession]);

  const handleUpload = () => {
    if (session) {
      router.push({
        pathname: '/upload',
        params: { sessionId: session.session_id },
      });
    }
  };

  const toggleStudentExpand = (index: number) => {
    const newExpanded = new Set(expandedStudents);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedStudents(newExpanded);
  };

  const openPagePreview = (student: ScannedStudent, pageIndex: number) => {
    setPreviewModal({
      visible: true,
      pages: student.pages,
      currentIndex: pageIndex,
      studentLabel: student.label,
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderStudentCard = (student: ScannedStudent, index: number) => {
    const isExpanded = expandedStudents.has(index);
    
    return (
      <View key={index} style={styles.studentCard}>
        <TouchableOpacity
          style={styles.studentHeader}
          onPress={() => toggleStudentExpand(index)}
          activeOpacity={0.7}
        >
          <View style={styles.studentIcon}>
            <Ionicons name="person" size={20} color={COLORS.primary} />
          </View>
          <View style={styles.studentInfo}>
            <Text style={styles.studentName}>{student.label}</Text>
            <Text style={styles.studentMeta}>
              {student.page_count} pages
              {student.barcode_data && ` • Roll: ${student.barcode_data.data}`}
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

        {/* Expanded Pages View */}
        {isExpanded && (
          <View style={styles.pagesGrid}>
            {student.pages.length === 0 ? (
              <Text style={styles.noPagesText}>No pages scanned</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pagesScrollContent}
              >
                {student.pages.map((page, pageIdx) => (
                  <TouchableOpacity
                    key={page.id}
                    style={styles.pageThumb}
                    onPress={() => openPagePreview(student, pageIdx)}
                    activeOpacity={0.8}
                  >
                    {page.file_path ? (
                      <Image
                        source={{ uri: page.file_path }}
                        style={styles.pageThumbImage}
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
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderPreviewModal = () => (
    <Modal
      visible={previewModal.visible}
      animationType="fade"
      transparent={false}
      onRequestClose={() => setPreviewModal({ ...previewModal, visible: false })}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => setPreviewModal({ ...previewModal, visible: false })}
            style={styles.modalCloseBtn}
          >
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.modalHeaderInfo}>
            <Text style={styles.modalTitle}>
              {previewModal.studentLabel} - Page {previewModal.pages[previewModal.currentIndex]?.page_number}
            </Text>
            <Text style={styles.modalSubtitle}>
              {previewModal.currentIndex + 1} of {previewModal.pages.length}
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {previewModal.pages.length > 1 && (
          <FlatList
            horizontal
            data={previewModal.pages}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <TouchableOpacity 
                key={item.id}
                onPress={() => {
                    setPreviewModal({...previewModal, currentIndex: index});
                    flatListRef.current?.scrollToIndex({index, animated: true});
                }}
                style={[
                  styles.navThumbnail,
                  previewModal.currentIndex === index && styles.navThumbnailActive
                ]}
              />
            )}
          />
        )}

        <FlatList
          ref={flatListRef}
          data={previewModal.pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setPreviewModal({ ...previewModal, currentIndex: index });
          }}
          renderItem={({ item }) => (
            <View style={styles.modalImageContainer}>
              {item.file_path ? (
                <Image
                  source={{ uri: item.file_path }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.modalNoImage}>
                  <Ionicons name="image-outline" size={64} color={COLORS.textMuted} />
                  <Text style={styles.modalNoImageText}>No preview</Text>
                </View>
              )}
            </View>
          )}
          keyExtractor={(item) => item.id}
        />

        {previewModal.pages.length > 1 && (
          <View style={styles.swipeHint}>
            <Ionicons name="swap-horizontal" size={16} color={COLORS.textMuted} />
            <Text style={styles.swipeHintText}>Swipe to view other pages</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );

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
      {renderPreviewModal()}
      
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
          studentsWithPages.map((student, index) => renderStudentCard(student, index))
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
    resizeMode: 'cover',
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
