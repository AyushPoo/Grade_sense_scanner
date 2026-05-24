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
  onDelete,
  onPreview,
}: {
  page: ScannedPage;
  pageIndex: number;
  student: ScannedStudent;
  onRetake: (student: ScannedStudent, page: ScannedPage, pageIndex: number) => void;
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
        <TouchableOpacity
          style={styles.thumbActionBtn}
          onPress={() => onRetake(student, page, pageIndex)}
        >
          <Ionicons name="camera-outline" size={14} color={COLORS.primary} />
          <Text style={styles.thumbActionLabel}>Retake</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.thumbActionBtn}
          onPress={() => {
            Alert.alert('Delete page', 'Remove this scan?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => onDelete(student.student_index, pageIndex) },
            ]);
          }}
        >
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
  onDelete,
  onPreview,
  onRename,
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

  const { setRetake, deletePage, renameStudent } = useScanStore(useShallow(state => ({
    setRetake:     state.setRetake,
    deletePage:    state.deletePage,
    renameStudent: state.renameStudent,
  })));

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
            onDelete={handleDelete}
            onPreview={handlePreview}
            onRename={handleRename}
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
});
