import React, { useEffect, useRef } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ReviewFileSlide } from '../../types/review';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PaperFileViewerProps {
  slides: ReviewFileSlide[];
  activeIndex: number;
  failedImageIds: Record<string, boolean>;
  onSelectIndex: (index: number) => void;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
}

export function PaperFileViewer({
  slides,
  activeIndex,
  failedImageIds,
  onSelectIndex,
  onImageError,
  onRetry,
}: PaperFileViewerProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeIndex * SCREEN_WIDTH, animated: true });
  }, [activeIndex]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (nextIndex !== activeIndex && slides[nextIndex]) {
      onSelectIndex(nextIndex);
    }
  };

  if (slides.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="image-outline" size={60} color={COLORS.textMuted} />
        <Text style={styles.emptyText}>No scanned paper files found</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pagerHeader}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileTabs}>
          {slides.map((slide, index) => (
            <TouchableOpacity
              key={slide.id}
              style={[styles.fileTab, activeIndex === index && styles.activeFileTab]}
              onPress={() => onSelectIndex(index)}
              activeOpacity={0.8}
            >
              <Text style={[styles.fileTabText, activeIndex === index && styles.activeFileTabText]}>
                {slide.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
        style={styles.viewer}
      >
        {slides.map(slide => {
          const hasError = failedImageIds[slide.id];
          const imageUrl = slide.annotationSignedUrl || slide.signedUrl;
          const isPdf = isPdfSlide(slide, imageUrl);

          return (
            <View key={slide.id} style={styles.slide}>
              {imageUrl && !hasError && isPdf ? (
                <WebView
                  key={`${slide.id}-${imageUrl}`}
                  source={{ uri: buildPdfViewerUrl(imageUrl) }}
                  style={styles.webView}
                  startInLoadingState
                  onError={() => onImageError(slide.id)}
                  onHttpError={() => onImageError(slide.id)}
                />
              ) : imageUrl && !hasError ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.sheetImage}
                  contentFit="contain"
                  onError={() => onImageError(slide.id)}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons name="warning-outline" size={52} color={COLORS.textMuted} />
                  <Text style={styles.emptyTitle}>{slide.title} not loaded</Text>
                  <Text style={styles.emptyText}>The signed file link may have expired.</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
                    <Ionicons name="refresh" size={16} color="#fff" />
                    <Text style={styles.retryText}>Refresh file</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
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
    flex: 1,
    backgroundColor: '#141414',
  },
  pagerHeader: {
    backgroundColor: '#101010',
    borderBottomWidth: 1,
    borderBottomColor: '#272727',
    paddingVertical: 9,
  },
  fileTabs: {
    gap: 8,
    paddingHorizontal: 14,
  },
  fileTab: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  activeFileTab: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  fileTabText: {
    color: '#E7E7E7',
    fontSize: 12,
    fontWeight: '800',
  },
  activeFileTabText: {
    color: '#fff',
  },
  viewer: {
    flex: 1,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetImage: {
    width: '100%',
    height: '100%',
  },
  webView: {
    backgroundColor: '#1E1E1E',
    width: '100%',
    height: '100%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#E6E6E6',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyText: {
    color: '#B8B8B8',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  retryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
