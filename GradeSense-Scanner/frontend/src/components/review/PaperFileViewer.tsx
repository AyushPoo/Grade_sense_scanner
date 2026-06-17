import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Dimensions,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../../config';
import type { ReviewFileSlide } from '../../types/review';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SINGLE_DOCUMENT_HEIGHT = Math.max(590, SCREEN_WIDTH * 1.5);
const COMPARE_PANE_MIN_HEIGHT = Math.max(250, SCREEN_WIDTH * 0.7);

interface PaperFileViewerProps {
  slides: ReviewFileSlide[];
  activeIndex: number;
  failedImageIds: Record<string, boolean>;
  viewerState?: PaperFileViewerState;
  onSelectIndex: (index: number) => void;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
  onViewerStateChange?: (state: Partial<PaperFileViewerState>) => void;
}

type DocumentType = ReviewFileSlide['type'];

export interface PaperFileViewerState {
  compareMode: boolean;
  scrollOffsets: Record<string, number>;
}

interface DocumentGroup {
  type: DocumentType;
  title: string;
  slides: ReviewFileSlide[];
  firstIndex: number;
}

const DOCUMENT_ORDER: DocumentType[] = ['student', 'model', 'question', 'other'];

export function PaperFileViewer({
  slides,
  activeIndex,
  failedImageIds,
  viewerState,
  onSelectIndex,
  onImageError,
  onRetry,
  onViewerStateChange,
}: PaperFileViewerProps) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const groups = useMemo(() => buildDocumentGroups(slides), [slides]);
  const compareMode = viewerState?.compareMode ?? false;
  const scrollOffsets = viewerState?.scrollOffsets ?? {};
  const activeType = slides[activeIndex]?.type || groups[0]?.type;
  const activeGroup = groups.find(group => group.type === activeType) || groups[0];
  const compareGroups = groups.filter(group => group.type === 'student' || group.type === 'model');
  const canCompare = compareGroups.length > 1;

  const hasAnnotationUrl = useMemo(() => {
    return activeGroup?.slides.some(slide => Boolean(slide.annotationSignedUrl)) ?? false;
  }, [activeGroup]);

  const setCompareMode = useCallback((nextValue: boolean) => {
    onViewerStateChange?.({ compareMode: nextValue });
  }, [onViewerStateChange]);

  const setScrollOffset = useCallback((key: string, offset: number) => {
    onViewerStateChange?.({
      scrollOffsets: {
        ...scrollOffsets,
        [key]: offset,
      },
    });
  }, [onViewerStateChange, scrollOffsets]);

  useEffect(() => {
    slides
      .map(slide => slide.annotationSignedUrl || slide.signedUrl)
      .filter((uri): uri is string => Boolean(uri))
      .filter(uri => !uri.toLowerCase().includes('.pdf'))
      .slice(0, 6)
      .forEach(uri => {
        Image.prefetch(uri).catch(() => {});
      });
  }, [slides]);

  if (slides.length === 0 || !activeGroup) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="image-outline" size={52} color={COLORS.textMuted} />
        <Text style={styles.emptyText}>No scanned paper files found</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Ionicons name="refresh" size={15} color="#fff" />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const openGroup = (group: DocumentGroup) => {
    setCompareMode(false);
    onSelectIndex(group.firstIndex);
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.documentTabs}>
          {groups.map(group => (
            <TouchableOpacity
              key={group.type}
              style={[styles.documentTab, !compareMode && activeGroup.type === group.type && styles.activeDocumentTab]}
              onPress={() => openGroup(group)}
              activeOpacity={0.8}
            >
              <Text style={[styles.documentTabText, !compareMode && activeGroup.type === group.type && styles.activeDocumentTabText]}>
                {group.title}
              </Text>
            </TouchableOpacity>
          ))}

          {canCompare ? (
            <TouchableOpacity
              style={[styles.documentTab, compareMode && styles.activeDocumentTab]}
              onPress={() => setCompareMode(!compareMode)}
              activeOpacity={0.8}
            >
              <Ionicons name="git-compare-outline" size={13} color={compareMode ? '#fff' : '#E7E7E7'} />
              <Text style={[styles.documentTabText, compareMode && styles.activeDocumentTabText]}>Compare</Text>
            </TouchableOpacity>
          ) : null}

          {hasAnnotationUrl ? (
            <TouchableOpacity
              style={[styles.documentTab, !showOriginal && styles.activeDocumentTabOriginal]}
              onPress={() => setShowOriginal(!showOriginal)}
              activeOpacity={0.8}
            >
              <Ionicons name={!showOriginal ? "create-outline" : "image-outline"} size={13} color={!showOriginal ? '#fff' : '#E7E7E7'} />
              <Text style={[styles.documentTabText, !showOriginal && styles.activeDocumentTabText]}>
                {!showOriginal ? 'Show Original' : 'Show Graded'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>

      {compareMode && canCompare ? (
        <CompareDocumentView
          groups={compareGroups}
          failedImageIds={failedImageIds}
          scrollOffsets={scrollOffsets}
          onImageError={onImageError}
          onRetry={onRetry}
          onScrollOffsetChange={setScrollOffset}
          showOriginal={showOriginal}
        />
      ) : (
        <DocumentGroupView
          group={activeGroup}
          failedImageIds={failedImageIds}
          scrollKey={`single-${activeGroup.type}`}
          initialScrollOffset={scrollOffsets[`single-${activeGroup.type}`] || 0}
          onImageError={onImageError}
          onRetry={onRetry}
          onScrollOffsetChange={setScrollOffset}
          showOriginal={showOriginal}
        />
      )}
    </View>
  );
}

function CompareDocumentView({
  groups,
  failedImageIds,
  scrollOffsets,
  onImageError,
  onRetry,
  onScrollOffsetChange,
  showOriginal = false,
}: {
  groups: DocumentGroup[];
  failedImageIds: Record<string, boolean>;
  scrollOffsets: Record<string, number>;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
  onScrollOffsetChange: (key: string, offset: number) => void;
  showOriginal?: boolean;
}) {
  const studentGroup = groups.find(group => group.type === 'student');
  const modelGroup = groups.find(group => group.type === 'model');

  return (
    <View style={styles.splitCompareContainer}>
      <SplitComparePane
        title="Student Sheet"
        group={studentGroup}
        failedImageIds={failedImageIds}
        scrollOffsets={scrollOffsets}
        onImageError={onImageError}
        onRetry={onRetry}
        onScrollOffsetChange={onScrollOffsetChange}
        showOriginal={showOriginal}
      />
      <SplitComparePane
        title="Model Answer"
        group={modelGroup}
        failedImageIds={failedImageIds}
        scrollOffsets={scrollOffsets}
        onImageError={onImageError}
        onRetry={onRetry}
        onScrollOffsetChange={onScrollOffsetChange}
        showOriginal={showOriginal}
      />
    </View>
  );
}

function SplitComparePane({
  title,
  group,
  failedImageIds,
  scrollOffsets,
  onImageError,
  onRetry,
  onScrollOffsetChange,
  showOriginal = false,
}: {
  title: string;
  group?: DocumentGroup;
  failedImageIds: Record<string, boolean>;
  scrollOffsets: Record<string, number>;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
  onScrollOffsetChange: (key: string, offset: number) => void;
  showOriginal?: boolean;
}) {
  if (!group) {
    return (
      <View style={styles.splitPane}>
        <Text style={styles.splitPaneTitle}>{title}</Text>
        <View style={styles.splitPaneEmpty}>
          <Ionicons name="document-outline" size={28} color="#777" />
          <Text style={styles.splitPaneEmptyText}>{title} is not available for this paper.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.splitPane}>
      <Text style={styles.splitPaneTitle}>{title}</Text>
      <DocumentGroupView
        group={group}
        compact
        failedImageIds={failedImageIds}
        scrollKey={`compare-${group.type}`}
        initialScrollOffset={scrollOffsets[`compare-${group.type}`] || 0}
        onImageError={onImageError}
        onRetry={onRetry}
        onScrollOffsetChange={onScrollOffsetChange}
        showOriginal={showOriginal}
      />
    </View>
  );
}

function DocumentGroupView({
  group,
  compact = false,
  failedImageIds,
  scrollKey,
  initialScrollOffset = 0,
  onImageError,
  onRetry,
  onScrollOffsetChange,
  showOriginal = false,
}: {
  group: DocumentGroup;
  compact?: boolean;
  failedImageIds: Record<string, boolean>;
  scrollKey: string;
  initialScrollOffset?: number;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
  onScrollOffsetChange: (key: string, offset: number) => void;
  showOriginal?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);

  const restoreScroll = useCallback(() => {
    if (initialScrollOffset <= 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: initialScrollOffset, animated: false });
    });
  }, [initialScrollOffset]);

  useEffect(() => {
    restoreScroll();
  }, [restoreScroll]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.documentScroll}
      contentContainerStyle={[styles.documentContent, compact && styles.compactDocumentContent]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      onContentSizeChange={restoreScroll}
      onScroll={event => onScrollOffsetChange(scrollKey, event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={160}
    >
      {group.slides.map((slide, index) => (
        <View key={slide.id} style={[styles.pageFrame, compact && styles.compactPageFrame]}>
          {group.slides.length > 1 ? (
            <Text style={styles.pageLabel}>Page {index + 1}</Text>
          ) : null}
          <PaperPage
            slide={slide}
            compact={compact}
            hasError={Boolean(failedImageIds[slide.id])}
            onImageError={onImageError}
            onRetry={onRetry}
            showOriginal={showOriginal}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function PaperPage({
  slide,
  compact,
  hasError,
  onImageError,
  onRetry,
  showOriginal = false,
}: {
  slide: ReviewFileSlide;
  compact: boolean;
  hasError: boolean;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
  showOriginal?: boolean;
}) {
  const imageUrl = showOriginal
    ? (slide.signedUrl || slide.annotationSignedUrl)
    : (slide.annotationSignedUrl || slide.signedUrl);
  const openExternal = () => {
    if (imageUrl) {
      Linking.openURL(imageUrl).catch(() => onRetry());
    }
  };

  if (!imageUrl || hasError) {
    return (
      <View style={[styles.pageError, compact && styles.compactPageError]}>
        <Ionicons name="warning-outline" size={compact ? 32 : 42} color={COLORS.textMuted} />
        <Text style={styles.emptyTitle}>{slide.title} not loaded</Text>
        <Text style={styles.emptyText}>The signed file link may have expired or the PDF viewer could not render it.</Text>
        <View style={styles.recoveryRow}>
          <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
            <Ionicons name="refresh" size={15} color="#fff" />
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
          {imageUrl ? (
            <TouchableOpacity style={styles.openButton} onPress={openExternal}>
              <Ionicons name="open-outline" size={15} color="#E7E7E7" />
              <Text style={styles.openButtonText}>Open file</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const isPdf = isPdfSlide(slide, imageUrl);

  if (!isPdf) {
    return (
      <View>
        <ZoomableImagePage
          uri={imageUrl}
          compact={compact}
          onImageError={() => onImageError(slide.id)}
        />
        <PageRecoveryActions compact={compact} onRetry={onRetry} onOpenExternal={openExternal} />
      </View>
    );
  }

  const uri = buildPdfViewerUrl(imageUrl);

  return (
    <View>
      <WebView
        key={`${slide.id}-${imageUrl}`}
        originWhitelist={['*']}
        source={isPdf ? { uri } : { html: uri, baseUrl: '' }}
        style={[styles.webView, compact && styles.compactWebView]}
        startInLoadingState
        nestedScrollEnabled
        setSupportZoom
        scalesPageToFit
        onError={() => onImageError(slide.id)}
        onHttpError={() => onImageError(slide.id)}
      />
      <PageRecoveryActions compact={compact} onRetry={onRetry} onOpenExternal={openExternal} />
    </View>
  );
}

function ZoomableImagePage({
  uri,
  compact,
  onImageError,
}: {
  uri: string;
  compact: boolean;
  onImageError: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 6);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate(event => {
      if (scale.value <= 1.02) return;
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View style={[styles.imageViewport, compact && styles.compactImageViewport]}>
        <Animated.View style={[styles.zoomLayer, animatedStyle]}>
          <Image
            source={{ uri }}
            style={styles.nativeImage}
            contentFit="contain"
            onError={onImageError}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function PageRecoveryActions({
  compact,
  onRetry,
  onOpenExternal,
}: {
  compact: boolean;
  onRetry: () => void;
  onOpenExternal: () => void;
}) {
  return (
    <View style={[styles.pageActions, compact && styles.compactPageActions]}>
      <TouchableOpacity style={styles.pageActionButton} onPress={onRetry}>
        <Ionicons name="refresh" size={13} color="#E7E7E7" />
        <Text style={styles.pageActionText}>Refresh link</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.pageActionButton} onPress={onOpenExternal}>
        <Ionicons name="open-outline" size={13} color="#E7E7E7" />
        <Text style={styles.pageActionText}>Open source</Text>
      </TouchableOpacity>
    </View>
  );
}

function buildDocumentGroups(slides: ReviewFileSlide[]): DocumentGroup[] {
  return DOCUMENT_ORDER.flatMap(type => {
    const groupedSlides = slides
      .map((slide, index) => ({ slide, index }))
      .filter(item => item.slide.type === type);

    if (!groupedSlides.length) {
      return [];
    }

    return [{
      type,
      title: getGroupTitle(type),
      slides: groupedSlides.map(item => item.slide),
      firstIndex: groupedSlides[0].index,
    }];
  });
}

function getGroupTitle(type: DocumentType): string {
  switch (type) {
    case 'student':
      return 'Student Sheet';
    case 'model':
      return 'Model Answer';
    case 'question':
      return 'Question Paper';
    default:
      return 'Other Files';
  }
}

function isPdfSlide(slide: ReviewFileSlide, url: string | null): boolean {
  const source = `${slide.contentType || ''} ${slide.originalName || ''} ${url || ''}`.toLowerCase();
  return source.includes('application/pdf') || source.includes('.pdf');
}

function buildPdfViewerUrl(url: string): string {
  if (url.startsWith('file://')) {
    return url;
  }
  return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#141414',
    flex: 1,
  },
  toolbar: {
    backgroundColor: '#101010',
    borderBottomColor: '#272727',
    borderBottomWidth: 1,
    paddingVertical: 5,
  },
  documentTabs: {
    gap: 6,
    paddingHorizontal: 8,
  },
  documentTab: {
    alignItems: 'center',
    borderColor: '#333',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activeDocumentTab: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  activeDocumentTabOriginal: {
    backgroundColor: COLORS.info,
    borderColor: COLORS.info,
  },
  documentTabText: {
    color: '#E7E7E7',
    fontSize: 11,
    fontWeight: '800',
  },
  activeDocumentTabText: {
    color: '#fff',
  },
  documentScroll: {
    flex: 1,
  },
  documentContent: {
    gap: 10,
    padding: 8,
    paddingBottom: 28,
  },
  compactDocumentContent: {
    gap: 7,
    padding: 7,
    paddingBottom: 10,
  },
  pageFrame: {
    backgroundColor: '#0E0E0E',
    borderColor: '#2A2A2A',
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
  },
  compactPageFrame: {
    borderRadius: 8,
  },
  pageLabel: {
    color: '#C8C8C8',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: 'uppercase',
  },
  webView: {
    backgroundColor: '#111',
    height: SINGLE_DOCUMENT_HEIGHT,
    width: '100%',
  },
  compactWebView: {
    height: COMPARE_PANE_MIN_HEIGHT,
  },
  imageViewport: {
    alignItems: 'center',
    backgroundColor: '#111',
    height: SINGLE_DOCUMENT_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  compactImageViewport: {
    height: COMPARE_PANE_MIN_HEIGHT,
  },
  zoomLayer: {
    height: '100%',
    width: '100%',
  },
  nativeImage: {
    height: '100%',
    width: '100%',
  },
  splitCompareContainer: {
    flex: 1,
    gap: 8,
    padding: 8,
  },
  splitPane: {
    backgroundColor: '#0E0E0E',
    borderColor: '#2A2A2A',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: COMPARE_PANE_MIN_HEIGHT,
    overflow: 'hidden',
  },
  splitPaneTitle: {
    color: '#F5F5F5',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  splitPaneEmpty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 14,
  },
  splitPaneEmptyText: {
    color: '#AFAFAF',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pageError: {
    alignItems: 'center',
    height: 420,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  compactPageError: {
    height: 220,
  },
  emptyTitle: {
    color: '#E6E6E6',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
  },
  emptyText: {
    color: '#B8B8B8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  recoveryRow: {
    flexDirection: 'row',
    gap: 9,
  },
  openButton: {
    alignItems: 'center',
    borderColor: '#333',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  openButtonText: {
    color: '#E7E7E7',
    fontSize: 12,
    fontWeight: '700',
  },
  pageActions: {
    backgroundColor: '#101010',
    borderTopColor: '#252525',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 6,
  },
  compactPageActions: {
    padding: 5,
  },
  pageActionButton: {
    alignItems: 'center',
    borderColor: '#333',
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 30,
  },
  pageActionText: {
    color: '#E7E7E7',
    fontSize: 10,
    fontWeight: '800',
  },
});
