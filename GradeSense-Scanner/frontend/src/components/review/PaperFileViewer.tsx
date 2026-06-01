import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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

type DocumentType = ReviewFileSlide['type'];

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
  onSelectIndex,
  onImageError,
  onRetry,
}: PaperFileViewerProps) {
  const [splitMode, setSplitMode] = useState(false);
  const groups = useMemo(() => buildDocumentGroups(slides), [slides]);
  const activeType = slides[activeIndex]?.type || groups[0]?.type;
  const activeGroup = groups.find(group => group.type === activeType) || groups[0];
  const canSplit = Boolean(groups.find(group => group.type === 'student') && groups.find(group => group.type === 'model'));

  if (slides.length === 0 || !activeGroup) {
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

  const openGroup = (group: DocumentGroup) => {
    setSplitMode(false);
    onSelectIndex(group.firstIndex);
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.documentTabs}>
          {groups.map(group => (
            <TouchableOpacity
              key={group.type}
              style={[styles.documentTab, !splitMode && activeGroup.type === group.type && styles.activeDocumentTab]}
              onPress={() => openGroup(group)}
              activeOpacity={0.8}
            >
              <Text style={[styles.documentTabText, !splitMode && activeGroup.type === group.type && styles.activeDocumentTabText]}>
                {group.title}
              </Text>
            </TouchableOpacity>
          ))}
          {canSplit ? (
            <TouchableOpacity
              style={[styles.documentTab, splitMode && styles.activeDocumentTab]}
              onPress={() => setSplitMode(value => !value)}
              activeOpacity={0.8}
            >
              <Ionicons name="git-compare-outline" size={14} color={splitMode ? '#fff' : '#E7E7E7'} />
              <Text style={[styles.documentTabText, splitMode && styles.activeDocumentTabText]}>Split</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>

      {splitMode ? (
        <SplitDocumentView
          groups={groups}
          failedImageIds={failedImageIds}
          onImageError={onImageError}
          onRetry={onRetry}
        />
      ) : (
        <DocumentGroupView
          group={activeGroup}
          failedImageIds={failedImageIds}
          onImageError={onImageError}
          onRetry={onRetry}
        />
      )}
    </View>
  );
}

function SplitDocumentView({
  groups,
  failedImageIds,
  onImageError,
  onRetry,
}: {
  groups: DocumentGroup[];
  failedImageIds: Record<string, boolean>;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
}) {
  const studentGroup = groups.find(group => group.type === 'student');
  const modelGroup = groups.find(group => group.type === 'model');

  return (
    <View style={styles.splitContainer}>
      {studentGroup ? (
        <SplitPane
          group={studentGroup}
          failedImageIds={failedImageIds}
          onImageError={onImageError}
          onRetry={onRetry}
        />
      ) : null}
      {modelGroup ? (
        <SplitPane
          group={modelGroup}
          failedImageIds={failedImageIds}
          onImageError={onImageError}
          onRetry={onRetry}
        />
      ) : null}
    </View>
  );
}

function SplitPane({
  group,
  failedImageIds,
  onImageError,
  onRetry,
}: {
  group: DocumentGroup;
  failedImageIds: Record<string, boolean>;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.splitPane}>
      <Text style={styles.splitTitle}>{group.title}</Text>
      <DocumentGroupView
        group={group}
        compact
        failedImageIds={failedImageIds}
        onImageError={onImageError}
        onRetry={onRetry}
      />
    </View>
  );
}

function DocumentGroupView({
  group,
  compact = false,
  failedImageIds,
  onImageError,
  onRetry,
}: {
  group: DocumentGroup;
  compact?: boolean;
  failedImageIds: Record<string, boolean>;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
}) {
  return (
    <ScrollView
      style={styles.documentScroll}
      contentContainerStyle={[styles.documentContent, compact && styles.compactDocumentContent]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
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
}: {
  slide: ReviewFileSlide;
  compact: boolean;
  hasError: boolean;
  onImageError: (slideId: string) => void;
  onRetry: () => void;
}) {
  const imageUrl = slide.annotationSignedUrl || slide.signedUrl;

  if (!imageUrl || hasError) {
    return (
      <View style={[styles.pageError, compact && styles.compactPageError]}>
        <Ionicons name="warning-outline" size={42} color={COLORS.textMuted} />
        <Text style={styles.emptyTitle}>{slide.title} not loaded</Text>
        <Text style={styles.emptyText}>The signed file link may have expired.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.retryText}>Refresh file</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const uri = isPdfSlide(slide, imageUrl) ? buildPdfViewerUrl(imageUrl) : buildZoomableImageHtml(imageUrl);

  return (
    <WebView
      key={`${slide.id}-${imageUrl}`}
      originWhitelist={['*']}
      source={isPdfSlide(slide, imageUrl) ? { uri } : { html: uri, baseUrl: '' }}
      style={[styles.webView, compact && styles.compactWebView]}
      startInLoadingState
      nestedScrollEnabled
      setSupportZoom
      scalesPageToFit
      onError={() => onImageError(slide.id)}
      onHttpError={() => onImageError(slide.id)}
    />
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

function buildZoomableImageHtml(url: string): string {
  const escapedUrl = url.replace(/"/g, '&quot;');
  return `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=8, user-scalable=yes" />
        <style>
          html, body { margin: 0; padding: 0; background: #111; min-height: 100%; }
          body { display: flex; justify-content: center; align-items: flex-start; }
          img { display: block; width: 100%; height: auto; object-fit: contain; }
        </style>
      </head>
      <body>
        <img src="${escapedUrl}" />
      </body>
    </html>
  `;
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
    paddingVertical: 9,
  },
  documentTabs: {
    gap: 8,
    paddingHorizontal: 14,
  },
  documentTab: {
    alignItems: 'center',
    borderColor: '#333',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  activeDocumentTab: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  documentTabText: {
    color: '#E7E7E7',
    fontSize: 12,
    fontWeight: '800',
  },
  activeDocumentTabText: {
    color: '#fff',
  },
  documentScroll: {
    flex: 1,
  },
  documentContent: {
    gap: 14,
    padding: 12,
    paddingBottom: 28,
  },
  compactDocumentContent: {
    padding: 8,
    paddingBottom: 12,
  },
  pageFrame: {
    backgroundColor: '#0E0E0E',
    borderColor: '#2A2A2A',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  compactPageFrame: {
    borderRadius: 10,
  },
  pageLabel: {
    color: '#C8C8C8',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 8,
    textTransform: 'uppercase',
  },
  webView: {
    backgroundColor: '#111',
    height: Math.max(520, SCREEN_WIDTH * 1.35),
    width: '100%',
  },
  compactWebView: {
    height: 310,
  },
  splitContainer: {
    flex: 1,
    gap: 10,
    padding: 10,
  },
  splitPane: {
    backgroundColor: '#0E0E0E',
    borderColor: '#2A2A2A',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  splitTitle: {
    color: '#F5F5F5',
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 12,
    paddingTop: 10,
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
    height: 260,
  },
  emptyTitle: {
    color: '#E6E6E6',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyText: {
    color: '#B8B8B8',
    fontSize: 14,
    lineHeight: 21,
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
