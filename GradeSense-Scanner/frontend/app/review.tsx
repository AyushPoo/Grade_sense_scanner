import React, { useState, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  TextInput,
  Dimensions,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore, qualityScore, QualityLevel, PendingRetake } from '../src/store/scanStore';
import { useShallow } from 'zustand/react/shallow';
import { ScannedStudent, ScannedPage } from '../src/types';
import { applyFilter, FilterMode, Quadrilateral } from '../src/utils/cvProcessor';
import { File, Paths } from 'expo-file-system';
import { CropOverlay } from '../src/components/CropOverlay';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import { Image as RNImage } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Quality badge colours ─────────────────────────────────────────────────────
const QUALITY_COLORS: Record<QualityLevel, { bg: string; text: string; label: string }> = {
  green:  { bg: '#1D9E75', text: '#fff', label: 'Clear' },
  yellow: { bg: '#EF9F27', text: '#fff', label: 'Fair' },
  red:    { bg: '#E24B4A', text: '#fff', label: 'Blurry' },
};

// ── Page thumbnail with quality badge + actions ───────────────────────────────
const PageThumb = memo(({
  page,
  pageIndex,
  student,
  onRetake,
  onCrop,
  onDelete,
  onPreview,
}: {
  page: ScannedPage;
  pageIndex: number;
  student: ScannedStudent;
  onRetake: (student: ScannedStudent, page: ScannedPage, pageIndex: number) => void;
  onCrop: (student: ScannedStudent, page: ScannedPage, pageIndex: number) => void;
  onDelete: (studentIndex: number, pageIndex: number) => void;
  onPreview: (student: ScannedStudent, pageIndex: number) => void;
}) => {
  const quality = qualityScore(page.sharpness_score ?? 0, page.is_blurry ?? false);
  const qc      = QUALITY_COLORS[quality];

  return (
    <View style={styles.thumbContainer}>
      <TouchableOpacity onPress={() => onPreview(student, pageIndex)} activeOpacity={0.8}>
        <Image
          source={{ uri: page.file_path }}
          style={styles.thumbImage}
          contentFit="cover"
        />

        {/* Page number badge */}
        <View style={styles.pageNumBadge}>
          <Text style={styles.pageNumText}>P{page.page_number}</Text>
        </View>

        {/* Quality badge */}
        <View style={[styles.qualityBadge, { backgroundColor: qc.bg }]}>
          <Text style={[styles.qualityText, { color: qc.text }]}>{qc.label}</Text>
        </View>
      </TouchableOpacity>

      {/* Actions row */}
      <View style={styles.thumbActions}>
        <TouchableOpacity style={styles.thumbActionBtn} onPress={() => onRetake(student, page, pageIndex)}>
          <Ionicons name="camera-outline" size={14} color={COLORS.primary} />
        </TouchableOpacity>

        {page.raw_file_path && (
          <TouchableOpacity style={styles.thumbActionBtn} onPress={() => onCrop(student, page, pageIndex)}>
            <Ionicons name="crop-outline" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.thumbActionBtn} onPress={() => {
            Alert.alert('Delete page', 'Remove this scan?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => onDelete(student.student_index, pageIndex) },
            ]);
        }}>
          <Ionicons name="trash-outline" size={14} color={COLORS.danger ?? '#E24B4A'} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ── Student card ──────────────────────────────────────────────────────────────
const StudentCard = memo(({
  student,
  isExpanded,
  onToggle,
  onRetake,
  onCrop,
  onDelete,
  onPreview,
  onRename,
  onAppend,
}: any) => {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput]     = useState(student.label);
  const inputRef = useRef<TextInput>(null);

  const startEdit = () => {
    setEditingName(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setEditingName(false);
    if (nameInput.trim() && nameInput.trim() !== student.label) {
      onRename(student.student_index, nameInput.trim());
    }
  };

  // Aggregate quality for header dot
  const worstQuality: QualityLevel = student.pages.some(
    (p: ScannedPage) => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) === 'red'
  ) ? 'red'
    : student.pages.some(
    (p: ScannedPage) => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) === 'yellow'
  ) ? 'yellow'
    : 'green';

  const showDot = student.page_count > 0;

  return (
    <View style={styles.studentCard}>
      <TouchableOpacity style={styles.studentHeader} onPress={() => onToggle(student.student_index)}>
        {/* Quality dot */}
        {showDot && (
          <View style={[styles.qualityDot, { backgroundColor: QUALITY_COLORS[worstQuality].bg }]} />
        )}

        <View style={styles.studentInfo}>
          {editingName ? (
            <TextInput
              ref={inputRef}
              style={styles.studentNameInput}
              value={nameInput}
              onChangeText={setNameInput}
              onBlur={commitName}
              onSubmitEditing={commitName}
              returnKeyType="done"
              selectTextOnFocus
            />
          ) : (
            <TouchableOpacity onPress={startEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.studentName}>{student.label}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.studentMeta}>
            {student.page_count > 0 ? `${student.page_count} page${student.page_count !== 1 ? 's' : ''}` : 'No pages yet'}
          </Text>
        </View>

        <TouchableOpacity 
          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
          onPress={(e) => {
            e.stopPropagation();
            onAppend(student.student_index);
          }}
        >
          <Ionicons name="add" size={14} color={COLORS.primary} />
          <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '600' }}>Add Pages</Text>
        </TouchableOpacity>

        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.pagesRow}>
          {student.pages.length > 0 ? (
            <FlatList
              data={student.pages}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => item.id || `page-${index}`}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
              renderItem={({ item, index }) => (
                <PageThumb
                  page={item}
                  pageIndex={index}
                  student={student}
                  onRetake={onRetake}
                  onCrop={onCrop}
                  onDelete={onDelete}
                  onPreview={onPreview}
                />
              )}
            />
          ) : (
            <Text style={styles.emptyLabel}>No pages scanned yet</Text>
          )}
        </View>
      )}
    </View>
  );
});

// ── Main ReviewScreen ─────────────────────────────────────────────────────────
export default function ReviewScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const session = useScanStore(useShallow(state => {
    const sId = sessionId || state.currentSession?.session_id;
    return state.savedSessions.find(s => s.session_id === sId) || state.currentSession;
  }));

  const { setRetake, deletePage, renameStudent, updatePagePathAndFilter } = useScanStore(useShallow(state => ({
    setRetake:     state.setRetake,
    deletePage:    state.deletePage,
    renameStudent: state.renameStudent,
    updatePagePathAndFilter: state.updatePagePathAndFilter,
  })));

  const FILTERS: { id: FilterMode; label: string; icon: string }[] = [
    { id: 'original',           label: 'Original',    icon: 'image-outline' },
    { id: 'grayscale',          label: 'Grayscale',   icon: 'contrast-outline' },
    { id: 'high_contrast',      label: 'Hi-Contrast', icon: 'sunny-outline' },
    { id: 'adaptive_threshold', label: 'OCR Binarize', icon: 'scan-outline' },
  ];
  const [isApplyingGlobalFilter, setIsApplyingGlobalFilter] = useState(false);
  const [cropTarget, setCropTarget] = useState<{ student: ScannedStudent, page: ScannedPage, pageIndex: number } | null>(null);
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);

  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(() => {
    // Auto-expand students that have quality issues
    const initial = new Set<number>();
    session?.students.forEach(s => {
      if (s.pages.some(p => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) !== 'green')) {
        initial.add(s.student_index);
      }
    });
    return initial;
  });

  const handleToggle = useCallback((studentIndex: number) => {
    setExpandedStudents(prev => {
      const next = new Set(prev);
      next.has(studentIndex) ? next.delete(studentIndex) : next.add(studentIndex);
      return next;
    });
  }, []);

  const handleRetake = useCallback((
    student: ScannedStudent,
    page: ScannedPage,
    pageIndex: number,
  ) => {
    setRetake({
      pageId:              page.id,
      studentIndex:        student.student_index,
      phase:               'students',
      replaceIndex:        pageIndex,
      originalPageNumber:  page.page_number,
      originalFilePath:    page.file_path,
    });
    // Push back to scanner — it will show the retake banner automatically
    router.push('/scanner');
  }, [setRetake, router]);

  const handleCrop = useCallback((student: ScannedStudent, page: ScannedPage, pageIndex: number) => {
    setCropTarget({ student, page, pageIndex });
  }, []);

  const handleDelete = useCallback((studentIndex: number, pageIndex: number) => {
    deletePage(studentIndex, pageIndex, 'students');
  }, [deletePage]);

  const handlePreview = useCallback((student: ScannedStudent, pageIndex: number) => {
    // Navigate to a full-screen preview — implement as a modal route
    router.push({
      pathname: '/page-preview',
      params: {
        studentIndex: student.student_index,
        pageNumber: student.pages[pageIndex]?.page_number.toString(),
        phase: 'students',
      },
    });
  }, [router, session]);

  const handleRename = useCallback((studentIndex: number, newLabel: string) => {
    renameStudent(studentIndex, newLabel);
  }, [renameStudent]);

  const handleAppend = useCallback((studentIndex: number) => {
    useScanStore.setState({
      currentPhase: 'students',
      currentStudentIndex: studentIndex
    });
    router.push('/scanner');
  }, [router]);

  const handleGlobalFilter = async (filter: FilterMode) => {
    if (!session || isApplyingGlobalFilter) return;
    setIsApplyingGlobalFilter(true);
    let errorCount = 0;

    try {
      // Loop students and pages
      for (const student of session.students) {
        for (const page of student.pages) {
          if (page.filter_mode === filter) continue;
          const sourceUri = page.original_file_path || page.file_path;
          
          try {
            const filteredUri = await applyFilter(sourceUri, filter);
            const filename = `scanned_filtered_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            const dest = new File(Paths.document, filename);
            new File(filteredUri).copy(dest);

            let verified = false;
            for (let i = 0; i < 10; i++) {
              if (dest.exists) { verified = true; break; }
              await new Promise(r => setTimeout(r, 50));
            }

            if (verified) {
              updatePagePathAndFilter(page.id, 'students', student.student_index, dest.uri, filter);
            } else {
              errorCount++;
            }
          } catch (e) {
            errorCount++;
          }
        }
      }
      
      if (errorCount > 0) {
        Alert.alert('Warning', `Failed to apply filter to ${errorCount} pages.`);
      }
    } finally {
      setIsApplyingGlobalFilter(false);
    }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = React.useMemo(() => {
    if (!session) return { total: 0, green: 0, yellow: 0, red: 0 };
    let green = 0, yellow = 0, red = 0;
    session.students.forEach(s => {
      s.pages.forEach(p => {
        const q = qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false);
        if (q === 'green') green++;
        else if (q === 'yellow') yellow++;
        else red++;
      });
    });
    return { total: green + yellow + red, green, yellow, red };
  }, [session]);

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyLabel}>No session found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionName}>{session.session_name}</Text>
          <Text style={styles.batchName}>{session.batch_name}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/scanner')} style={styles.scanMoreBtn}>
          <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
          <Text style={styles.scanMoreText}>Scan more</Text>
        </TouchableOpacity>
      </View>

      {/* Quality summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryDot, { backgroundColor: QUALITY_COLORS.green.bg }]} />
          <Text style={styles.summaryCount}>{stats.green}</Text>
          <Text style={styles.summaryLabel}>clear</Text>
        </View>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryDot, { backgroundColor: QUALITY_COLORS.yellow.bg }]} />
          <Text style={styles.summaryCount}>{stats.yellow}</Text>
          <Text style={styles.summaryLabel}>fair</Text>
        </View>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryDot, { backgroundColor: QUALITY_COLORS.red.bg }]} />
          <Text style={styles.summaryCount}>{stats.red}</Text>
          <Text style={styles.summaryLabel}>blurry</Text>
        </View>
        <Text style={styles.summaryTotal}>{stats.total} pages total</Text>
      </View>

      {/* Global Filter Palette */}
      <View style={styles.filterPaletteContainer}>
        <Text style={styles.sectionTitle}>APPLY TO ALL PAGES</Text>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.filterChip}
              onPress={() => handleGlobalFilter(item.id)}
              disabled={isApplyingGlobalFilter}
            >
              <Ionicons 
                name={item.icon as any} 
                size={16} 
                color={COLORS.primary} 
              />
              <Text style={styles.filterChipText}>{item.label}</Text>
            </TouchableOpacity>
          )}
        />
        {isApplyingGlobalFilter && (
          <View style={styles.globalFilterOverlay}>
            <Text style={{color: '#fff', fontSize: 13, fontWeight: 'bold'}}>Applying filter...</Text>
          </View>
        )}
      </View>

      {/* Student list */}
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 100 }}>
        <Text style={styles.sectionTitle}>STUDENTS ({session.students.length})</Text>
        {session.students.filter(s => s.page_count > 0 || (s.student_index === 0 && session.students.length === 1)).map(student => (
          <StudentCard
            key={student.id || `student-${student.student_index}`}
            student={student}
            isExpanded={expandedStudents.has(student.student_index)}
            onToggle={handleToggle}
            onRetake={handleRetake}
            onCrop={handleCrop}
            onDelete={handleDelete}
            onPreview={handlePreview}
            onRename={handleRename}
            onAppend={handleAppend}
          />
        ))}
      </ScrollView>

      {/* Upload CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.uploadButton}
          onPress={() => router.push({ pathname: '/upload', params: { sessionId: session.session_id } })}
        >
          <Text style={styles.uploadButtonText}>Upload to GradeSense</Text>
        </TouchableOpacity>
      </View>

      {cropTarget && cropTarget.page.raw_file_path && (
        <View style={StyleSheet.absoluteFill}>
          <CropOverlay
            imageUri={cropTarget.page.raw_file_path}
            initialQuad={cropTarget.page.crop_quad}
            onCancel={() => setCropTarget(null)}
            onCropComplete={async (quad) => {
              try {
                setIsProcessingCrop(true);
                const rawUri = cropTarget.page.raw_file_path!;
                
                // Get original image dimensions
                const dims = await new Promise<{width: number, height: number}>((resolve, reject) => {
                  RNImage.getSize(rawUri, (w, h) => resolve({width: w, height: h}), reject);
                });

                // Run perspective warp
                const norm = await normalizeCapturedDocument(rawUri, quad, dims);
                
                // Save original warped image (before filter)
                const origFilename = `orig_${Date.now()}.jpg`;
                const destOrig = new File(Paths.document, origFilename);
                new File(norm.uri).copy(destOrig);

                // Wait for file system
                let origVerified = false;
                for (let i = 0; i < 10; i++) {
                    if (destOrig.exists) { origVerified = true; break; }
                    await new Promise(r => setTimeout(r, 50));
                }

                // Apply current filter
                const filterToApply = cropTarget.page.filter_mode || 'grayscale';
                const filteredUri = await applyFilter(destOrig.uri, filterToApply);

                const finalFilename = `scanned_${Date.now()}.jpg`;
                const dest = new File(Paths.document, finalFilename);
                new File(filteredUri).copy(dest);

                let verified = false;
                for (let i = 0; i < 10; i++) {
                    if (dest.exists) { verified = true; break; }
                    await new Promise(r => setTimeout(r, 50));
                }

                if (verified) {
                    // Update store with new paths and quad
                    const pages = [...cropTarget.student.pages];
                    pages[cropTarget.pageIndex] = {
                        ...pages[cropTarget.pageIndex],
                        file_path: dest.uri,
                        original_file_path: destOrig.uri,
                        crop_quad: quad,
                    };
                    useScanStore.setState(state => {
                        const newSessions = [...state.savedSessions];
                        const sessionIndex = newSessions.findIndex(s => s.session_id === session.session_id);
                        if (sessionIndex > -1) {
                            newSessions[sessionIndex].students[cropTarget.student.student_index].pages = pages;
                            return { savedSessions: newSessions };
                        }
                        if (state.currentSession?.session_id === session.session_id) {
                            const newStudents = [...state.currentSession.students];
                            newStudents[cropTarget.student.student_index].pages = pages;
                            return { currentSession: { ...state.currentSession, students: newStudents } };
                        }
                        return state;
                    });
                }
              } catch (e) {
                Alert.alert('Error', 'Failed to process crop');
                console.warn(e);
              } finally {
                setIsProcessingCrop(false);
                setCropTarget(null);
              }
            }}
          />
          {isProcessingCrop && (
            <View style={styles.globalFilterOverlay}>
              <Text style={{color: '#fff', fontSize: 13, fontWeight: 'bold'}}>Applying Crop...</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const THUMB_W = 90;
const THUMB_H = 120;

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: COLORS.backgroundDark },
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn:          { padding: 4 },
  sessionName:      { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary },
  batchName:        { fontSize: 13, color: COLORS.textMuted, marginTop: 1 },
  scanMoreBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.primary },
  scanMoreText:     { fontSize: 13, color: COLORS.primary, fontWeight: '500' },

  summaryBar:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  summaryItem:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryDot:       { width: 8, height: 8, borderRadius: 4 },
  summaryCount:     { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary },
  summaryLabel:     { fontSize: 12, color: COLORS.textMuted },
  summaryTotal:     { marginLeft: 'auto', fontSize: 12, color: COLORS.textMuted },

  list:             { flex: 1 },
  sectionTitle:     { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },

  studentCard:      { marginHorizontal: 12, marginBottom: 8, backgroundColor: COLORS.card, borderRadius: 12, overflow: 'hidden' },
  studentHeader:    { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  qualityDot:       { width: 10, height: 10, borderRadius: 5 },
  studentInfo:      { flex: 1 },
  studentName:      { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary },
  studentNameInput: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, padding: 0, borderBottomWidth: 1, borderColor: COLORS.primary },
  studentMeta:      { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  pagesRow:         { paddingVertical: 10 },
  emptyLabel:       { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', padding: 16 },

  thumbContainer:   { width: THUMB_W, alignItems: 'center' },
  thumbImage:       { width: THUMB_W, height: THUMB_H, borderRadius: 6 },
  pageNumBadge:     { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  pageNumText:      { color: '#fff', fontSize: 10, fontWeight: '600' },
  qualityBadge:     { position: 'absolute', bottom: 4, left: 4, right: 4, borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  qualityText:      { fontSize: 10, fontWeight: '700' },
  thumbActions:     { flexDirection: 'row', justifyContent: 'space-between', width: THUMB_W, marginTop: 4 },
  thumbActionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4 },
  thumbActionLabel: { fontSize: 11, color: COLORS.primary },

  footer:           { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  uploadButton:     { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  filterPaletteContainer: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, position: 'relative' },
  filterChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChipText:   { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  globalFilterOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
});
