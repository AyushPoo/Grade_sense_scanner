import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Alert,
  ActivityIndicator,
  BackHandler,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { ScannedPage, ScanPhase } from '../src/types';
import { applyFilter, FilterMode, Quadrilateral } from '../src/utils/cvProcessor';
import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { isPdfScannedPage } from '../src/utils/scannedPageAssets';
import { CropOverlay } from '../src/components/CropOverlay';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_IMAGE_HEIGHT = SCREEN_HEIGHT * 0.6;
const MAX_PREVIEW_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.3;

function InlineZoomableImage({
  uri,
  isZoomed,
  onZoomChange,
  onLoadStart,
  onLoadEnd,
}: {
  uri: string;
  isZoomed: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const lastDoubleTapAt = useSharedValue(0);

  const clamp = (value: number, min: number, max: number) => {
    'worklet';
    return Math.max(min, Math.min(max, value));
  };

  const clampTranslation = (nextX: number, nextY: number, nextScale: number) => {
    'worklet';
    const boundX = (SCREEN_WIDTH * Math.max(0, nextScale - 1)) / 2;
    const boundY = (PREVIEW_IMAGE_HEIGHT * Math.max(0, nextScale - 1)) / 2;
    return {
      x: clamp(nextX, -boundX, boundX),
      y: clamp(nextY, -boundY, boundY),
    };
  };

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    runOnJS(onZoomChange)(false);
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate(event => {
      const nextScale = clamp(savedScale.value * event.scale, 1, MAX_PREVIEW_ZOOM);
      const clamped = clampTranslation(translateX.value, translateY.value, nextScale);
      scale.value = nextScale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      if (scale.value <= 1.05) {
        reset();
        return;
      }
      const clamped = clampTranslation(translateX.value, translateY.value, scale.value);
      translateX.value = withTiming(clamped.x);
      translateY.value = withTiming(clamped.y);
      savedTranslateX.value = clamped.x;
      savedTranslateY.value = clamped.y;
      savedScale.value = scale.value;
      runOnJS(onZoomChange)(scale.value > 1.05);
    });

  const panGesture = Gesture.Pan()
    .enabled(isZoomed)
    .onUpdate(event => {
      if (scale.value > 1) {
        const clamped = clampTranslation(
          savedTranslateX.value + event.translationX,
          savedTranslateY.value + event.translationY,
          scale.value,
        );
        translateX.value = clamped.x;
        translateY.value = clamped.y;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd(() => {
      const now = Date.now();
      if (now - lastDoubleTapAt.value < 280) return;
      lastDoubleTapAt.value = now;

      if (scale.value > 1.1) {
        reset();
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(onZoomChange)(true);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureHandlerRootView style={styles.imageTouchArea}>
      <GestureDetector gesture={Gesture.Simultaneous(doubleTapGesture, pinchGesture, panGesture)}>
        <Animated.View style={[styles.zoomableLayer, animatedStyle]}>
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit="contain"
            cachePolicy="none"
            transition={150}
            onLoadStart={onLoadStart}
            onLoadEnd={onLoadEnd}
          />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

export default function PagePreviewScreen() {
  const router = useRouter();
  const { pageNumber, phase, studentIndex } = useLocalSearchParams<{
    pageNumber: string;
    phase: string;
    studentIndex?: string;
  }>();

  const { currentSession, removePage, startRetake, currentPhase, currentStudentIndex, updatePagePathAndFilter, rotatePage } = useScanStore();
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isApplyingFilter, setIsApplyingFilter] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [cropTarget, setCropTarget] = useState<ScannedPage | null>(null);
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  const [zoomedPageId, setZoomedPageId] = useState<string | null>(null);
  const [showDevDiagnostics, setShowDevDiagnostics] = useState(false);

  const FILTERS: { id: FilterMode; label: string; icon: string }[] = [
    { id: 'original',           label: 'Original',    icon: 'image-outline' },
    { id: 'grayscale',          label: 'Grayscale',   icon: 'contrast-outline' },
    { id: 'high_contrast',      label: 'Hi-Contrast', icon: 'sunny-outline' },
    { id: 'adaptive_threshold', label: 'OCR Binarize', icon: 'scan-outline' },
  ];
  // TASK 2A: Per-page loading state instead of single global boolean
  const [loadingPages, setLoadingPages] = useState<Set<string>>(new Set());

  // Get pages based on phase
  const getPages = (): ScannedPage[] => {
    if (!currentSession) return [];
    
    const phaseToUse = phase || currentPhase;
    const studentIdx = studentIndex ? parseInt(studentIndex) : currentStudentIndex;
    
    if (phaseToUse === 'question_paper') {
      return currentSession.question_paper.pages;
    } else if (phaseToUse === 'model_answer') {
      return currentSession.model_answer.pages;
    } else {
      return currentSession.students[studentIdx]?.pages || [];
    }
  };

  const pages = getPages();

  useEffect(() => {
    if (!cropTarget) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setCropTarget(null);
      return true;
    });
    return () => subscription.remove();
  }, [cropTarget]);
  
  // Find initial page index
  useEffect(() => {
    if (pageNumber && pages.length > 0) {
      const index = pages.findIndex(p => p.page_number === parseInt(pageNumber));
      if (index >= 0) {
        setCurrentIndex(index);
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index, animated: false });
        }, 100);
      }
    }
  }, [pageNumber, pages.length]);

  const getPhaseLabel = () => {
    const phaseToUse = phase || currentPhase;
    switch (phaseToUse) {
      case 'question_paper': return 'Question Paper';
      case 'model_answer': return 'Model Answer';
      default: return 'Student Paper';
    }
  };

  const handleDelete = () => {
    const currentPage = pages[currentIndex];
    if (!currentPage) return;

    Alert.alert(
      'Delete Page',
      `Are you sure you want to delete Page ${currentPage.page_number}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const phaseToUse = phase || currentPhase;
            const studentIdx = studentIndex ? parseInt(studentIndex) : undefined;
            removePage(currentPage.page_number, phaseToUse as ScanPhase, studentIdx);
            // Navigate back if no more pages
            if (pages.length <= 1) {
              router.back();
            } else if (currentIndex >= pages.length - 1) {
              setCurrentIndex(Math.max(0, currentIndex - 1));
            }
          },
        },
      ]
    );
  };

  const handleApplyFilter = async (filter: FilterMode) => {
    const currentPage = getPages()[currentIndex];
    if (!currentPage || isApplyingFilter) return;
    if (isPdfScannedPage(currentPage)) return;
    if (currentPage.filter_mode === filter) return;

    // Use original if available, else current (though without original, non-destructive is hard)
    const sourceUri = currentPage.original_file_path || currentPage.file_path;

    setIsApplyingFilter(true);
    try {
      const filteredUri = await applyFilter(sourceUri, filter);
      
      const filename = `scanned_filtered_${Date.now()}.jpg`;
      const dest = new File(Paths.document, filename);
      new File(filteredUri).copy(dest);

      let verified = false;
      for (let i = 0; i < 10; i++) {
        if (dest.exists) { verified = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }

      if (verified) {
        const phaseToUse = phase || currentPhase;
        const studentIdx = studentIndex ? parseInt(studentIndex) : undefined;
        updatePagePathAndFilter(currentPage.id, phaseToUse, studentIdx, dest.uri, filter);
      } else {
         Alert.alert('Error', 'Failed to save filtered image.');
      }
    } catch (e) {
      console.warn('[ApplyFilter]', e);
      Alert.alert('Error', 'Failed to apply filter.');
    } finally {
      setIsApplyingFilter(false);
    }
  };

  const handleRetake = () => {
    Alert.alert(
      'Retake Page',
      'Go back to camera to retake this page?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retake',
          onPress: () => {
            // Initiate transactional retake instead of immediate deletion
            const currentPage = pages[currentIndex];
            if (currentPage) {
              const phaseToUse = phase || currentPhase;
              const studentIdx = studentIndex ? parseInt(studentIndex) : undefined;
              startRetake(currentPage, phaseToUse as ScanPhase, studentIdx);
            }
            router.push('/scanner');
          },
        },
      ]
    );
  };

  const handleRotate = async () => {
    const currentPage = getPages()[currentIndex];
    if (!currentPage || isRotating || isApplyingFilter) return;
    if (isPdfScannedPage(currentPage)) return;

    setIsRotating(true);
    try {
      // 1. Rotate the active file_path
      const currentUri = currentPage.file_path;
      const manipResult = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      
      const filename = `scanned_rot_${Date.now()}.jpg`;
      const dest = new File(Paths.document, filename);
      new File(manipResult.uri).copy(dest);

      let verified = false;
      for (let i = 0; i < 10; i++) {
        if (dest.exists) { verified = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }

      if (!verified) {
        throw new Error('Failed to verify rotated image file');
      }

      // 2. Rotate the original_file_path if it exists
      let destOrigUri: string | undefined = undefined;
      if (currentPage.original_file_path) {
        const origUri = currentPage.original_file_path;
        const manipResultOrig = await ImageManipulator.manipulateAsync(
          origUri,
          [{ rotate: 90 }],
          { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
        );
        const filenameOrig = `orig_rot_${Date.now()}.jpg`;
        const destOrig = new File(Paths.document, filenameOrig);
        new File(manipResultOrig.uri).copy(destOrig);

        let verifiedOrig = false;
        for (let i = 0; i < 10; i++) {
          if (destOrig.exists) { verifiedOrig = true; break; }
          await new Promise(r => setTimeout(r, 50));
        }
        if (verifiedOrig) {
          destOrigUri = destOrig.uri;
        }
      }

      // 3. Update the state store
      const phaseToUse = phase || currentPhase;
      const studentIdx = studentIndex ? parseInt(studentIndex) : undefined;
      
      rotatePage(
        currentPage.id,
        phaseToUse,
        studentIdx,
        dest.uri,
        destOrigUri
      );

      // Clean up previous files to avoid bloating device storage
      try {
        if (currentPage.file_path) {
          const oldFile = new File(currentPage.file_path);
          if (oldFile.exists) oldFile.delete();
        }
        if (currentPage.original_file_path) {
          const oldOrigFile = new File(currentPage.original_file_path);
          if (oldOrigFile.exists) oldOrigFile.delete();
        }
      } catch {
        // ignore deletion errors
      }

    } catch (e) {
      console.warn('[RotatePage]', e);
      Alert.alert('Error', 'Failed to rotate image.');
    } finally {
      setIsRotating(false);
    }
  };

  const replaceCurrentPage = (updatedPage: ScannedPage) => {
    const targetSessionId = currentSession?.session_id;
    const phaseToUse = (phase || currentPhase) as ScanPhase;
    const studentIdx = studentIndex ? parseInt(studentIndex) : currentStudentIndex;

    useScanStore.setState(state => {
      const updateSession = (session: typeof state.currentSession) => {
        if (!session || session.session_id !== targetSessionId) return session;
        if (phaseToUse === 'question_paper') {
          const pages = [...session.question_paper.pages];
          const idx = pages.findIndex(page => page.id === updatedPage.id);
          if (idx < 0) return session;
          pages[idx] = updatedPage;
          return { ...session, question_paper: { ...session.question_paper, pages } };
        }
        if (phaseToUse === 'model_answer') {
          const pages = [...session.model_answer.pages];
          const idx = pages.findIndex(page => page.id === updatedPage.id);
          if (idx < 0) return session;
          pages[idx] = updatedPage;
          return { ...session, model_answer: { ...session.model_answer, pages } };
        }
        const students = [...session.students];
        const student = students[studentIdx];
        if (!student) return session;
        const pages = [...student.pages];
        const idx = pages.findIndex(page => page.id === updatedPage.id);
        if (idx < 0) return session;
        pages[idx] = updatedPage;
        students[studentIdx] = { ...student, pages };
        return { ...session, students };
      };

      const savedSessions = state.savedSessions.map(session => updateSession(session) || session);
      return {
        savedSessions,
        currentSession: updateSession(state.currentSession),
      };
    });

    if (phaseToUse === 'question_paper' || phaseToUse === 'model_answer') {
      useScanStore.getState().syncCurrentMetadata(phaseToUse).catch(err =>
        console.error('[PagePreviewCrop] Failed to sync cropped page:', err)
      );
    } else {
      useScanStore.getState().syncCurrentMetadata('student', studentIdx).catch(err =>
        console.error('[PagePreviewCrop] Failed to sync cropped student page:', err)
      );
    }
  };

  const handleCrop = () => {
    const currentPage = getPages()[currentIndex];
    if (!currentPage || isPdfScannedPage(currentPage) || isApplyingFilter || isRotating) return;
    setCropTarget(currentPage);
  };

  const handleCropComplete = async (quad: Quadrilateral) => {
    if (!cropTarget) return;
    setIsProcessingCrop(true);
    try {
      const rawUri = cropTarget.raw_file_path || cropTarget.original_file_path || cropTarget.file_path;
      const baked = await ImageManipulator.manipulateAsync(
        rawUri,
        [{ rotate: 0 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      const norm = await normalizeCapturedDocument(
        baked.uri,
        quad,
        { width: baked.width, height: baked.height },
        { isManualCrop: true }
      );
      try { new File(baked.uri).delete(); } catch {}

      const origFilename = `orig_${Date.now()}.jpg`;
      const destOrig = new File(Paths.document, origFilename);
      new File(norm.uri).copy(destOrig);

      let origVerified = false;
      for (let i = 0; i < 10; i++) {
        if (destOrig.exists) { origVerified = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }
      if (!origVerified) throw new Error('Failed to save cropped original');

      const filterToApply = cropTarget.filter_mode || 'grayscale';
      const filteredUri = await applyFilter(destOrig.uri, filterToApply);
      const finalFilename = `scanned_crop_${Date.now()}.jpg`;
      const dest = new File(Paths.document, finalFilename);
      new File(filteredUri).copy(dest);

      let verified = false;
      for (let i = 0; i < 10; i++) {
        if (dest.exists) { verified = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }
      if (!verified) throw new Error('Failed to save cropped image');

      replaceCurrentPage({
        ...cropTarget,
        file_path: dest.uri,
        original_file_path: destOrig.uri,
        crop_quad: quad,
        crop_applied: true,
        crop_confidence: undefined,
        orientation_degrees: 0 as const,
        needs_orientation_review: false,
        filter_mode: filterToApply,
      });
      setCropTarget(null);
    } catch (e) {
      console.warn('[PagePreviewCrop]', e);
      Alert.alert('Error', 'Failed to process crop.');
    } finally {
      setIsProcessingCrop(false);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      // TASK 2B: Only update current index, do NOT reset loading globally
      setCurrentIndex(viewableItems[0].index);
      setZoomedPageId(null);
    }
  }).current;

  const renderPage = ({ item, index }: { item: ScannedPage; index: number }) => {
    const isPdf = isPdfScannedPage(item);

    return (
      <View style={styles.pageContainer}>
        {item.file_path && isPdf ? (
          <View style={styles.pdfPreview}>
            <Ionicons name="document-text" size={72} color={COLORS.primary} />
            <Text style={styles.pdfPreviewTitle}>{item.original_name || `Page ${item.page_number}.pdf`}</Text>
            <Text style={styles.pdfPreviewBody}>PDF document selected for this paper.</Text>
          </View>
        ) : item.file_path ? (
        <View style={styles.imageTouchArea}>
          <InlineZoomableImage
            uri={item.file_path}
            isZoomed={zoomedPageId === item.id}
            onZoomChange={(zoomed) => setZoomedPageId(zoomed ? item.id : null)}
            onLoadStart={() => {
              // TASK 2C: Bind loading to specific page ID
              setLoadingPages(prev => new Set(prev).add(item.id));
            }}
            onLoadEnd={() => {
              setLoadingPages(prev => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
            }}
          />
          {__DEV__ && item.diagnostics && (
            <TouchableOpacity
              style={styles.diagToggleBtn}
              onPress={() => setShowDevDiagnostics(prev => !prev)}
            >
              <Ionicons name="bug-outline" size={18} color="#fff" />
            </TouchableOpacity>
          )}
          {__DEV__ && showDevDiagnostics && item.diagnostics && (
            <View style={styles.diagnosticsCard}>
              <View style={styles.diagHeader}>
                <Text style={styles.diagTitle}>Crop Diagnostics</Text>
                <TouchableOpacity onPress={() => setShowDevDiagnostics(false)}>
                  <Ionicons name="close" size={16} color="#aaa" />
                </TouchableOpacity>
              </View>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Detector:</Text> {item.diagnostics.detectorUsed.toUpperCase()}</Text>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Confidence:</Text> {item.diagnostics.confidence.toFixed(3)}</Text>
              <Text style={styles.diagText}><Text style={styles.diagLabel}>Accepted:</Text> {item.diagnostics.accepted ? 'YES' : 'NO'}</Text>
              {item.diagnostics.reason && (
                <Text style={styles.diagText}><Text style={styles.diagLabel}>Reason:</Text> {item.diagnostics.reason}</Text>
              )}
              {item.diagnostics.outputSize && (
                <Text style={styles.diagText}><Text style={styles.diagLabel}>Size:</Text> {item.diagnostics.outputSize}</Text>
              )}
              {item.diagnostics.cropQuad && (
                <Text style={styles.diagText} numberOfLines={1} ellipsizeMode="tail">
                  <Text style={styles.diagLabel}>Quad:</Text> {item.diagnostics.cropQuad}
                </Text>
              )}
            </View>
          )}
          {(loadingPages.has(item.id) || isApplyingFilter || isRotating) && index === currentIndex && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          )}
        </View>
        ) : (
        <View style={styles.noImage}>
          <Ionicons name="image-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.noImageText}>No preview available</Text>
        </View>
        )}
      </View>
    );
  };

  if (pages.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>No Pages</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.noImage}>
          <Text style={styles.noImageText}>No pages scanned yet</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentPage = pages[currentIndex];
  const currentPageIsPdf = currentPage ? isPdfScannedPage(currentPage) : false;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
          <Ionicons name="close" size={28} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>
            Page {currentPage?.page_number || 1} of {pages.length}
          </Text>
          <Text style={styles.headerSubtitle}>{getPhaseLabel()}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Page indicator dots */}
      {pages.length > 1 && (
        <View style={styles.pagination}>
          {pages.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.paginationDot,
                idx === currentIndex && styles.paginationDotActive,
              ]}
            />
          ))}
        </View>
      )}

      {/* Swipeable Pages */}
      <FlatList
        ref={flatListRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomedPageId}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
      />

      {/* Swipe hint */}
      {pages.length > 1 && (
        <View style={styles.swipeHint}>
          <Ionicons name="swap-horizontal" size={16} color={COLORS.textMuted} />
          <Text style={styles.swipeHintText}>Swipe to view other pages</Text>
        </View>
      )}

      {/* Footer with actions */}
      <View style={styles.footer}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons
              name={currentPageIsPdf ? 'document-text' : currentPage?.needs_orientation_review || currentPage?.is_blurry ? 'warning' : 'checkmark-circle'}
              size={18}
              color={currentPageIsPdf ? COLORS.primary : currentPage?.needs_orientation_review || currentPage?.is_blurry ? COLORS.warning : COLORS.success}
            />
            <Text style={styles.infoText}>
              {currentPageIsPdf ? 'PDF' : currentPage?.needs_orientation_review ? 'Check rotation' : currentPage?.is_blurry ? 'Blurry' : 'Sharp'}
            </Text>
          </View>
        </View>

        {!currentPageIsPdf && (
        <View style={styles.filterPalette}>
          <FlatList
            data={FILTERS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.filterListContainer}
            renderItem={({ item }) => {
              const isActive = (currentPage?.filter_mode || 'original') === item.id;
              return (
                <TouchableOpacity
                  style={[styles.filterChip, isActive && styles.filterChipActive]}
                  onPress={() => handleApplyFilter(item.id)}
                  disabled={isApplyingFilter}
                >
                  <Ionicons 
                    name={item.icon as any} 
                    size={16} 
                    color={isActive ? '#000' : COLORS.primary} 
                  />
                  <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleRetake}
            disabled={isApplyingFilter || isRotating}
          >
            <Ionicons name="refresh" size={20} color={COLORS.text} />
            <Text style={styles.actionText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={handleRotate}
            disabled={currentPageIsPdf || isApplyingFilter || isRotating}
          >
            <Ionicons name="sync-outline" size={20} color={COLORS.text} />
            <Text style={styles.actionText}>Rotate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleCrop}
            disabled={currentPageIsPdf || isApplyingFilter || isRotating}
          >
            <Ionicons name="crop-outline" size={20} color={COLORS.text} />
            <Text style={styles.actionText}>Crop</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={handleDelete}
            disabled={isApplyingFilter || isRotating}
          >
            <Ionicons name="trash" size={20} color={COLORS.error} />
            <Text style={[styles.actionText, { color: COLORS.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>

      {cropTarget && (
        <View style={StyleSheet.absoluteFill}>
          <CropOverlay
            imageUri={cropTarget.raw_file_path || cropTarget.original_file_path || cropTarget.file_path}
            initialQuad={cropTarget.crop_quad}
            onCancel={() => setCropTarget(null)}
            onCropComplete={handleCropComplete}
          />
          {isProcessingCrop && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  imageTouchArea: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomableLayer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
  },
  closeButton: {
    padding: 8,
  },
  headerInfo: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  pagination: {
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
    width: 24,
  },
  pageContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
  },
  pdfPreview: {
    width: SCREEN_WIDTH - 48,
    minHeight: SCREEN_HEIGHT * 0.42,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pdfPreviewTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 14,
  },
  pdfPreviewBody: {
    color: COLORS.textLight,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  noImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noImageText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  swipeHintText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  footer: {
    backgroundColor: COLORS.background,
    padding: 16,
    paddingBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.text,
  },
  filterPalette: {
    marginBottom: 16,
  },
  filterListContainer: {
    gap: 8,
    paddingHorizontal: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  filterChipTextActive: {
    color: '#000',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 13,
    paddingHorizontal: 4,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  deleteButton: {
    backgroundColor: `${COLORS.error}15`,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  diagToggleBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  diagnosticsCard: {
    position: 'absolute',
    top: 54,
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
});
