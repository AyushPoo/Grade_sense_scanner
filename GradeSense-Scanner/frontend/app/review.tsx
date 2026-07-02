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
  BackHandler,
  Platform,
  ActivityIndicator,
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
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import JSZip from 'jszip';
import { CropOverlay } from '../src/components/CropOverlay';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import * as ImageManipulator from 'expo-image-manipulator';
import { isPdfScannedPage } from '../src/utils/scannedPageAssets';
import Svg, { Circle } from 'react-native-svg';

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
  isSynced,
}: {
  page: ScannedPage;
  pageIndex: number;
  student: ScannedStudent;
  onRetake: (student: ScannedStudent, page: ScannedPage, pageIndex: number) => void;
  onCrop: (student: ScannedStudent, page: ScannedPage, pageIndex: number) => void;
  onDelete: (studentIndex: number, pageIndex: number) => void;
  onPreview: (student: ScannedStudent, pageIndex: number) => void;
  isSynced?: boolean;
}) => {
  const quality = qualityScore(page.sharpness_score ?? 0, page.is_blurry ?? false);
  const qc      = QUALITY_COLORS[quality];
  const isPdf = isPdfScannedPage(page);

  return (
    <View style={styles.thumbContainer}>
      <TouchableOpacity onPress={() => onPreview(student, pageIndex)} activeOpacity={0.8}>
        {isPdf ? (
          <View style={[styles.thumbImage, styles.pdfThumb]}>
            <Ionicons name="document-text" size={30} color={COLORS.primary} />
            <Text style={styles.pdfThumbText} numberOfLines={2}>
              {page.original_name || 'PDF'}
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: page.file_path }}
            style={styles.thumbImage}
            contentFit="cover"
            cachePolicy="none"
          />
        )}

        {/* Page number badge */}
        <View style={styles.pageNumBadge}>
          <Text style={styles.pageNumText}>P{page.page_number}</Text>
        </View>

        {/* Quality badge */}
        <View style={[styles.qualityBadge, { backgroundColor: isPdf ? COLORS.primary : qc.bg }]}>
          <Text style={[styles.qualityText, { color: '#fff' }]}>{isPdf ? 'PDF' : page.needs_orientation_review ? 'ROTATE?' : qc.label}</Text>
        </View>

        {page.split_part && (
          <View style={styles.splitBadge}>
            <Text style={styles.splitBadgeText}>{page.split_part.toUpperCase()}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Actions row */}
      {!isSynced && (
        <View style={styles.thumbActions}>
          <TouchableOpacity style={styles.thumbActionBtn} onPress={() => onRetake(student, page, pageIndex)}>
            <Ionicons name="camera-outline" size={14} color={COLORS.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.thumbActionBtn, isPdf && styles.thumbActionDisabled]}
            onPress={() => onCrop(student, page, pageIndex)}
            disabled={isPdf}
          >
            <Ionicons name="crop-outline" size={14} color={COLORS.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.thumbActionBtn} onPress={() => {
              Alert.alert('Delete page', 'Remove this scan?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => onDelete(student.student_index, pageIndex) },
              ]);
          }}>
            <Ionicons name="trash-outline" size={14} color={COLORS.danger ?? '#E24B4A'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});
PageThumb.displayName = 'PageThumb';

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
  isSynced,
}: any) => {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput]     = useState(student.label);
  const inputRef = useRef<TextInput>(null);

  const startEdit = () => {
    if (isSynced) return;
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
            <TouchableOpacity onPress={startEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={isSynced}>
              <Text style={styles.studentName}>{student.label}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.studentMeta}>
            {student.page_count > 0 ? `${student.page_count} page${student.page_count !== 1 ? 's' : ''}` : 'No pages yet'}
          </Text>
        </View>

        {!isSynced && (
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
        )}

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
                  isSynced={isSynced}
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
StudentCard.displayName = 'StudentCard';

// ── QP & MA collapsible card ──────────────────────────────────────────────────
const QPMASection = memo(({
  title,
  icon,
  color,
  pages,
  isExpanded,
  onToggle,
  onRetake,
  onCrop,
  onDelete,
  onPreview,
  onAppend,
  mockIndex,
  isSynced,
}: {
  title: string;
  icon: string;
  color: string;
  pages: ScannedPage[];
  isExpanded: boolean;
  onToggle: () => void;
  onRetake: (student: any, page: ScannedPage, pageIndex: number) => void;
  onCrop: (student: any, page: ScannedPage, pageIndex: number) => void;
  onDelete: (studentIndex: number, pageIndex: number) => void;
  onPreview: (student: any, pageIndex: number) => void;
  onAppend: () => void;
  mockIndex: number;
  isSynced?: boolean;
}) => {
  const worstQuality: QualityLevel = pages.some(
    (p: ScannedPage) => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) === 'red'
  ) ? 'red'
    : pages.some(
    (p: ScannedPage) => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) === 'yellow'
  ) ? 'yellow'
    : 'green';

  const mockStudent = {
    student_index: mockIndex,
    label: title,
    pages,
  };

  const showDot = pages.length > 0;

  return (
    <View style={styles.studentCard}>
      <TouchableOpacity style={styles.studentHeader} onPress={onToggle}>
        {/* Quality dot */}
        {showDot && (
          <View style={[styles.qualityDot, { backgroundColor: QUALITY_COLORS[worstQuality].bg }]} />
        )}

        <View style={styles.studentInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name={icon as any} size={18} color={color} />
            <Text style={styles.studentName}>{title}</Text>
          </View>
          <Text style={styles.studentMeta}>
            {pages.length > 0 ? `${pages.length} page${pages.length !== 1 ? 's' : ''}` : 'No pages yet'}
          </Text>
        </View>

        {!isSynced && (
          <TouchableOpacity 
            style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            onPress={(e) => {
              e.stopPropagation();
              onAppend();
            }}
          >
            <Ionicons name="add" size={14} color={COLORS.primary} />
            <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '600' }}>Add Pages</Text>
          </TouchableOpacity>
        )}

        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.pagesRow}>
          {pages.length > 0 ? (
            <FlatList
              data={pages}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, index) => item.id || `qpma-${index}`}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
              renderItem={({ item, index }) => (
                <PageThumb
                  page={item}
                  pageIndex={index}
                  student={mockStudent as any}
                  onRetake={onRetake}
                  onCrop={onCrop}
                  onDelete={onDelete}
                  onPreview={onPreview}
                  isSynced={isSynced}
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
QPMASection.displayName = 'QPMASection';

// ── Main ReviewScreen ─────────────────────────────────────────────────────────
export default function ReviewScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const session = useScanStore(useShallow(state => {
    const sId = sessionId || state.currentSession?.session_id;
    return state.savedSessions.find(s => s.session_id === sId) || state.currentSession;
  }));

  const isSynced = session ? ['syncing', 'uploaded', 'grading', 'graded', 'completed'].includes(session.status) : false;

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
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgressPercentage, setZipProgressPercentage] = useState(0);

  const handleShowOptions = () => {
    if (!session) return;
    
    const options: { text: string; onPress: () => void | Promise<void> }[] = [
      {
        text: 'Duplicate Draft',
        onPress: async () => {
          try {
            const { duplicateSession } = useScanStore.getState();
            const newSessionId = await duplicateSession(session.session_id);
            Alert.alert(
              'Draft Duplicated',
              'A new duplicate draft has been created successfully. Would you like to switch to it now?',
              [
                { text: 'No', style: 'cancel' },
                {
                  text: 'Yes',
                  onPress: () => {
                    router.setParams({ sessionId: newSessionId });
                  }
                }
              ]
            );
          } catch (err: any) {
            Alert.alert('Duplication Failed', err.message || 'Could not duplicate draft.');
          }
        }
      }
    ];

    if (isSynced) {
      options.unshift({
        text: 'Unlock Draft (Edit & Re-upload)',
        onPress: () => {
          Alert.alert(
            'Unlock Draft?',
            'This will unlock the local draft and allow you to scan more pages or change settings. You can then re-upload it. Continue?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Unlock',
                style: 'destructive',
                onPress: () => {
                  const { unlockSession } = useScanStore.getState();
                  unlockSession(session.session_id);
                  Alert.alert('Unlocked', 'The draft is now unlocked and editable.');
                }
              }
            ]
          );
        }
      });
    }

    Alert.alert(
      'Draft Options',
      'Manage this grading session draft.',
      [
        ...options.map(opt => ({
          text: opt.text,
          onPress: opt.onPress,
        })),
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const compileImagesToPdf = async (imageUris: string[], title: string): Promise<string> => {
    const imgHtmls = [];
    for (const uri of imageUris) {
      try {
        const filePath = uri.startsWith('file://') ? uri : `file://${uri}`;

        // Resize and compress the image first to prevent OOM crashes on large sessions (e.g. 280+ pages)
        const manipResult = await ImageManipulator.manipulateAsync(
          filePath,
          [{ resize: { width: 1000 } }],
          { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG }
        );

        // Read the compressed image as Base64
        const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Clean up the temporary compressed image file
        await FileSystem.deleteAsync(manipResult.uri, { idempotent: true });

        imgHtmls.push(
          `<div class="page"><img src="data:image/jpeg;base64,${base64}" /></div>`
        );
      } catch (err) {
        console.warn(`Failed to process image for PDF ${title}:`, err);
      }
    }

    const html = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            @page { size: A4; margin: 0; }
            html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: white; }
            .page {
              width: 100%;
              height: 100vh;
              page-break-after: always;
              page-break-inside: avoid;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            img {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              display: block;
            }
          </style>
        </head>
        <body>
          ${imgHtmls.join('')}
        </body>
      </html>
    `;
    
    const { uri } = await Print.printToFileAsync({ html });
    return uri;
  };

  const handleDownloadBackup = async () => {
    if (!session) return;
    setIsZipping(true);
    setZipProgressPercentage(2);
    const tempFiles: string[] = [];
    try {
      const zip = new JSZip();
      
      // 1. Add Question Paper as a PDF
      if (session.question_paper?.pages && session.question_paper.pages.length > 0) {
        try {
          setZipProgressPercentage(4);
          const uris = session.question_paper.pages.map(p => p.file_path);
          const pdfUri = await compileImagesToPdf(uris, 'question_paper');
          tempFiles.push(pdfUri);
          const base64 = await FileSystem.readAsStringAsync(pdfUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          zip.file('question_paper.pdf', base64, { base64: true });
        } catch (err) {
          console.warn('Failed to add QP PDF to zip:', err);
        }
      }

      // 2. Add Model Answer as a PDF
      if (session.model_answer?.pages && session.model_answer.pages.length > 0) {
        try {
          setZipProgressPercentage(6);
          const uris = session.model_answer.pages.map(p => p.file_path);
          const pdfUri = await compileImagesToPdf(uris, 'model_answer');
          tempFiles.push(pdfUri);
          const base64 = await FileSystem.readAsStringAsync(pdfUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          zip.file('model_answer.pdf', base64, { base64: true });
        } catch (err) {
          console.warn('Failed to add Model Answer PDF to zip:', err);
        }
      }

      // 3. Add Student Answer Papers as PDFs (one PDF per student)
      if (session.students) {
        const totalStudents = session.students.length;
        let count = 0;
        for (const student of session.students) {
          count++;
          const studentIndexSuffix = student.student_index !== undefined ? `_${student.student_index + 1}` : `_${count}`;
          const rawStudentName = student.name 
            ? `${student.name}${studentIndexSuffix}`
            : student.label 
              ? `${student.label}${studentIndexSuffix}`
              : `Student${studentIndexSuffix}`;
          const sanitizedName = rawStudentName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');

          const pct = Math.round(6 + (count / totalStudents) * 88);
          setZipProgressPercentage(pct);
          if (student.pages && student.pages.length > 0) {
            try {
              const uris = student.pages.map(p => p.file_path);
              const pdfUri = await compileImagesToPdf(uris, sanitizedName);
              tempFiles.push(pdfUri);
              const base64 = await FileSystem.readAsStringAsync(pdfUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              zip.file(`students/${sanitizedName}.pdf`, base64, { base64: true });
            } catch (err) {
              console.warn(`Failed to add Student ${rawStudentName} PDF to zip:`, err);
            }
          }
        }
      }

      // Generate ZIP file
      setZipProgressPercentage(96);
      const content = await zip.generateAsync({ type: 'base64' });
      const filename = `${session.session_name.replace(/\s+/g, '_')}_Backup_Scans.zip`;

      const shareZip = async (zipContent: string, zipFilename: string) => {
        const fileUri = `${FileSystem.cacheDirectory}${zipFilename}`;
        await FileSystem.writeAsStringAsync(fileUri, zipContent, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/zip',
            dialogTitle: 'Export Scanned Pages',
            UTI: 'public.zip-archive',
          });
        } else {
          Alert.alert('Sharing not available', 'Sharing is not supported on this device.');
        }
      };

      if (Platform.OS === 'android') {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            const directoryUri = permissions.directoryUri;
            const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
              directoryUri,
              filename,
              'application/zip'
            );
            await FileSystem.writeAsStringAsync(fileUri, content, {
              encoding: FileSystem.EncodingType.Base64,
            });
            Alert.alert('Download Complete', 'Backup ZIP has been saved to your selected directory.');
          } else {
            await shareZip(content, filename);
          }
        } catch (err) {
          console.warn('SAF failed, falling back to share sheet:', err);
          await shareZip(content, filename);
        }
      } else {
        await shareZip(content, filename);
      }
    } catch (err: any) {
      console.error('Error generating backup zip:', err);
      Alert.alert('Backup Failed', err.message || 'Could not compile backup ZIP.');
    } finally {
      // Clean up temporary PDF files
      for (const fileUri of tempFiles) {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (_) {}
      }
      setIsZipping(false);
      setZipProgressPercentage(0);
    }
  };
  const [cropTarget, setCropTarget] = useState<{ student: ScannedStudent, page: ScannedPage, pageIndex: number } | null>(null);
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);

  React.useEffect(() => {
    if (!cropTarget) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setCropTarget(null);
      return true;
    });
    return () => subscription.remove();
  }, [cropTarget]);

  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(() => {
    // Auto-expand students/sections that have quality issues
    const initial = new Set<number>();
    session?.students.forEach(s => {
      if (s.pages.some(p => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) !== 'green')) {
        initial.add(s.student_index);
      }
    });
    if (session?.question_paper?.pages?.some(p => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) !== 'green')) {
      initial.add(-1);
    }
    if (session?.model_answer?.pages?.some(p => qualityScore(p.sharpness_score ?? 0, p.is_blurry ?? false) !== 'green')) {
      initial.add(-2);
    }
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
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    setRetake({
      pageId:              page.id,
      studentIndex:        student.student_index,
      phase:               student.student_index === -1 ? 'question_paper' : student.student_index === -2 ? 'model_answer' : 'students',
      replaceIndex:        pageIndex,
      originalPageNumber:  page.page_number,
      originalFilePath:    page.file_path,
    });
    // Push back to scanner — it will show the retake banner automatically
    router.push('/scanner');
  }, [setRetake, router, isSynced]);

  const handleCrop = useCallback((student: ScannedStudent, page: ScannedPage, pageIndex: number) => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    setCropTarget({ student, page, pageIndex });
  }, [isSynced]);

  const handleDelete = useCallback((studentIndex: number, pageIndex: number) => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    if (studentIndex === -1) {
      deletePage(0, pageIndex, 'question_paper');
    } else if (studentIndex === -2) {
      deletePage(0, pageIndex, 'model_answer');
    } else {
      deletePage(studentIndex, pageIndex, 'students');
    }
  }, [deletePage, isSynced]);

  const handlePreview = useCallback((student: ScannedStudent, pageIndex: number) => {
    if (!session) return;
    const phaseToUse = student.student_index === -1 ? 'question_paper' : student.student_index === -2 ? 'model_answer' : 'students';
    router.push({
      pathname: '/page-preview',
      params: {
        sessionId: session.session_id,
        studentIndex: student.student_index.toString(),
        pageNumber: student.pages[pageIndex]?.page_number.toString(),
        phase: phaseToUse,
      },
    });
  }, [router, session]);

  const handleRename = useCallback((studentIndex: number, newLabel: string) => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    renameStudent(studentIndex, newLabel);
  }, [renameStudent, isSynced]);

  const handleAppend = useCallback((studentIndex: number) => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    useScanStore.setState({
      currentPhase: 'students',
      currentStudentIndex: studentIndex
    });
    router.push('/scanner');
  }, [router, isSynced]);

  const handleQPAppend = useCallback(() => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    useScanStore.setState({
      currentPhase: 'question_paper',
    });
    router.push('/scanner');
  }, [router, isSynced]);

  const handleMAAppend = useCallback(() => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    useScanStore.setState({
      currentPhase: 'model_answer',
    });
    router.push('/scanner');
  }, [router, isSynced]);

  const handleGlobalFilter = async (filter: FilterMode) => {
    if (isSynced) {
      Alert.alert('Read-only', 'This session has already been synced to the server and cannot be edited.');
      return;
    }
    if (!session || isApplyingGlobalFilter) return;
    setIsApplyingGlobalFilter(true);
    let errorCount = 0;

    try {
      // Loop students and pages
      for (const student of session.students) {
        for (const page of student.pages) {
          if (isPdfScannedPage(page)) continue;
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.sessionName} numberOfLines={1}>{session.session_name}</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: '/session-setup', params: { sessionId: session.session_id } })}>
              <Ionicons name={isSynced ? "eye-outline" : "create-outline"} size={16} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.batchName}>{session.batch_name}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {!isSynced && (
            <TouchableOpacity onPress={() => router.push('/scanner')} style={styles.scanMoreBtn}>
              <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
              <Text style={styles.scanMoreText}>Scan more</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleShowOptions} style={styles.optionsBtn}>
            <Ionicons name="ellipsis-vertical" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
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
        {(session.question_paper?.pages?.length > 0 || session.settings?.scan_question_paper) && (
          <>
            <Text style={styles.sectionTitle}>QUESTION PAPER</Text>
            <QPMASection
              title="Question Paper"
              icon="document-text-outline"
              color="#1976D2"
              pages={session.question_paper?.pages || []}
              isExpanded={expandedStudents.has(-1)}
              onToggle={() => handleToggle(-1)}
              onRetake={handleRetake}
              onCrop={handleCrop}
              onDelete={handleDelete}
              onPreview={handlePreview}
              onAppend={handleQPAppend}
              mockIndex={-1}
              isSynced={isSynced}
            />
          </>
        )}

        {(session.model_answer?.pages?.length > 0 || session.settings?.scan_model_answer) && (
          <>
            <Text style={styles.sectionTitle}>MODEL ANSWER</Text>
            <QPMASection
              title="Model Answer"
              icon="clipboard-outline"
              color="#388E3C"
              pages={session.model_answer?.pages || []}
              isExpanded={expandedStudents.has(-2)}
              onToggle={() => handleToggle(-2)}
              onRetake={handleRetake}
              onCrop={handleCrop}
              onDelete={handleDelete}
              onPreview={handlePreview}
              onAppend={handleMAAppend}
              mockIndex={-2}
              isSynced={isSynced}
            />
          </>
        )}

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
            isSynced={isSynced}
          />
        ))}
      </ScrollView>

            {/* Upload CTA */}
      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[styles.uploadButton, { flex: 1 }]}
            onPress={() => router.push({ pathname: '/upload', params: { sessionId: session.session_id } })}
          >
            <Text style={styles.uploadButtonText}>Upload to GradeSense</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.downloadBackupButton}
            onPress={handleDownloadBackup}
            disabled={isZipping}
            activeOpacity={0.7}
          >
            {isZipping ? (
              <View style={{ width: 50, height: 50, justifyContent: 'center', alignItems: 'center' }}>
                <Svg width={46} height={46} viewBox="0 0 50 50">
                  <Circle
                    cx="25"
                    cy="25"
                    r="20"
                    stroke="#E5E7EB"
                    strokeWidth="3"
                    fill="transparent"
                  />
                  <Circle
                    cx="25"
                    cy="25"
                    r="20"
                    stroke={COLORS.primary}
                    strokeWidth="3"
                    fill="transparent"
                    strokeDasharray="125.66"
                    strokeDashoffset={125.66 * (1 - zipProgressPercentage / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 25 25)"
                  />
                </Svg>
                <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLORS.primary }}>
                    {zipProgressPercentage}%
                  </Text>
                </View>
              </View>
            ) : (
              <Ionicons name="download-outline" size={24} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {cropTarget && (cropTarget.page.raw_file_path || cropTarget.page.file_path) && (
        <View style={StyleSheet.absoluteFill}>
          <CropOverlay
            key={cropTarget.page.id}
            imageUri={cropTarget.page.raw_file_path || cropTarget.page.file_path}
            initialQuad={cropTarget.page.crop_quad}
            onCancel={() => setCropTarget(null)}
            onCropComplete={async (quad) => {
              try {
                setIsProcessingCrop(true);
                const rawUri = cropTarget.page.raw_file_path || cropTarget.page.file_path;
                
                // TASK 1A: EXIF-bake the raw image before normalization
                // This ensures dimensions match what OpenCV sees (same as CropOverlay)
                const baked = await ImageManipulator.manipulateAsync(
                    rawUri,
                    [{ rotate: 0 }],
                    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                );
                const normalizedUri = baked.uri;
                const dims = { width: baked.width, height: baked.height };

                // Run perspective warp on EXIF-normalized image
                const norm = await normalizeCapturedDocument(normalizedUri, quad, dims, { isManualCrop: true });
                
                // Cleanup temp EXIF-baked file
                try { new File(normalizedUri).delete(); } catch (_) {}

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
                    // TASK 1D: Build updated page object
                    const updatedPage = {
                        ...cropTarget.student.pages[cropTarget.pageIndex],
                        file_path: dest.uri,
                        original_file_path: destOrig.uri,
                        crop_quad: quad,
                        crop_applied: true,
                        crop_confidence: undefined,
                        orientation_degrees: 0 as const,
                        needs_orientation_review: false,
                    };
                    // Fully immutable Zustand update — new references at every nesting level
                    // Previous code mutated in-place, so useShallow selector never detected changes
                    useScanStore.setState(state => {
                        const newSessions = [...state.savedSessions];
                        const sessionIndex = newSessions.findIndex(s => s.session_id === session.session_id);
                        if (sessionIndex > -1) {
                            const oldSession = newSessions[sessionIndex];
                            
                            if (cropTarget.student.student_index === -1) {
                                // Question Paper
                                const newQP = { ...oldSession.question_paper };
                                const newPages = [...newQP.pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newQP.pages = newPages;
                                newSessions[sessionIndex] = { ...oldSession, question_paper: newQP };
                            } else if (cropTarget.student.student_index === -2) {
                                // Model Answer
                                const newMA = { ...oldSession.model_answer };
                                const newPages = [...newMA.pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newMA.pages = newPages;
                                newSessions[sessionIndex] = { ...oldSession, model_answer: newMA };
                            } else {
                                // Students
                                const newStudents = [...oldSession.students];
                                const si = cropTarget.student.student_index;
                                const newPages = [...newStudents[si].pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newStudents[si] = { ...newStudents[si], pages: newPages };
                                newSessions[sessionIndex] = { ...oldSession, students: newStudents };
                            }
                            
                            return {
                                savedSessions: newSessions,
                                // Keep currentSession in sync
                                ...(state.currentSession?.session_id === oldSession.session_id
                                    ? { currentSession: newSessions[sessionIndex] }
                                    : {}),
                            };
                        }
                        if (state.currentSession?.session_id === session.session_id) {
                            const oldSession = state.currentSession;
                            if (cropTarget.student.student_index === -1) {
                                const newQP = { ...oldSession.question_paper };
                                const newPages = [...newQP.pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newQP.pages = newPages;
                                return { currentSession: { ...oldSession, question_paper: newQP } };
                            } else if (cropTarget.student.student_index === -2) {
                                const newMA = { ...oldSession.model_answer };
                                const newPages = [...newMA.pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newMA.pages = newPages;
                                return { currentSession: { ...oldSession, model_answer: newMA } };
                            } else {
                                const newStudents = [...oldSession.students];
                                const si = cropTarget.student.student_index;
                                const newPages = [...newStudents[si].pages];
                                newPages[cropTarget.pageIndex] = updatedPage;
                                newStudents[si] = { ...newStudents[si], pages: newPages };
                                return { currentSession: { ...oldSession, students: newStudents } };
                            }
                        }
                        return {};
                    });
                }
              } catch (e) {
                Alert.alert('Error', 'Failed to process crop');
                console.warn(e);
              } finally {
                setIsProcessingCrop(false);
                // TASK 1D: Defer overlay teardown to next frame so Zustand state propagates first
                requestAnimationFrame(() => setCropTarget(null));
              }
            }}
          />
          {__DEV__ && cropTarget.page.diagnostics && (
            <View style={styles.diagnosticsCard}>
              <View style={styles.diagHeader}>
                <Text style={styles.diagTitle}>Auto-Crop Diagnostics</Text>
              </View>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Detector:</Text> {cropTarget.page.diagnostics.detectorUsed.toUpperCase()}</Text>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Confidence:</Text> {cropTarget.page.diagnostics.confidence.toFixed(3)}</Text>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Accepted:</Text> {cropTarget.page.diagnostics.accepted ? 'YES' : 'NO'}</Text>
              {cropTarget.page.diagnostics.reason && (
                <Text style={styles.diagText}><Text style={styles.diagLabel}>Reason:</Text> {cropTarget.page.diagnostics.reason}</Text>
              )}
              {cropTarget.page.diagnostics.outputSize && (
                <Text style={styles.diagText}><Text style={styles.diagLabel}>Size:</Text> {cropTarget.page.diagnostics.outputSize}</Text>
              )}
              {cropTarget.page.diagnostics.cropQuad && (
                <Text style={styles.diagText} numberOfLines={1} ellipsizeMode="tail">
                  <Text style={styles.diagLabel}>Quad:</Text> {cropTarget.page.diagnostics.cropQuad}
                </Text>
              )}
            </View>
          )}
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
  pdfThumb:         { alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFF4EF', borderWidth: 1, borderColor: '#FFD8C8', padding: 6 },
  pdfThumbText:     { color: COLORS.text, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  pageNumBadge:     { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  pageNumText:      { color: '#fff', fontSize: 10, fontWeight: '600' },
  qualityBadge:     { position: 'absolute', bottom: 4, left: 4, right: 4, borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  qualityText:      { fontSize: 10, fontWeight: '700' },
  splitBadge:       { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  splitBadgeText:   { color: '#fff', fontSize: 9, fontWeight: '800' },
  thumbActions:     { flexDirection: 'row', justifyContent: 'space-between', width: THUMB_W, marginTop: 4 },
  thumbActionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4 },
  thumbActionDisabled: { opacity: 0.25 },
  thumbActionLabel: { fontSize: 11, color: COLORS.primary },

  footer:           { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  footerRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  uploadButton:     { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  downloadBackupButton: { width: 50, height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.primaryXLight || '#FFF4EF', justifyContent: 'center', alignItems: 'center' },

  filterPaletteContainer: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, position: 'relative' },
  filterChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChipText:   { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  globalFilterOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  diagnosticsCard: {
    position: 'absolute',
    top: 110,
    right: 12,
    left: 12,
    backgroundColor: 'rgba(17, 17, 17, 0.88)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    padding: 12,
    zIndex: 99,
  },
  diagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    paddingBottom: 6,
    marginBottom: 8,
  },
  diagTitle: {
    color: '#FF9800',
    fontSize: 13,
    fontWeight: 'bold',
  },
  diagText: {
    color: '#ddd',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    lineHeight: 15,
  },
  diagLabel: {
    color: '#aaa',
    fontWeight: 'bold',
  },
  optionsBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
});
