import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';
import { ScannedPage } from '../types';

interface ThumbnailStripProps {
  pages: ScannedPage[];
  onPagePress: (page: ScannedPage) => void;
  onDeletePress?: (pageNumber: number) => void;
}

const ThumbnailItem = React.memo(({ page, onPagePress }: { page: ScannedPage; onPagePress: (page: ScannedPage) => void }) => {
  return (
    <TouchableOpacity 
      style={styles.thumbnail}
      onPress={() => onPagePress(page)}
      activeOpacity={0.7}
    >
      {page.file_path ? (
        <Image 
          source={{ uri: page.file_path }} 
          style={styles.thumbnailImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <View style={styles.placeholderImage}>
          <Ionicons name="document" size={24} color={COLORS.textMuted} />
        </View>
      )}
      <View style={styles.pageNumberBadge}>
        <Text style={styles.pageNumberText}>P{page.page_number}</Text>
      </View>
      {page.is_blurry && (
        <View style={styles.blurryBadge}>
          <Ionicons name="warning" size={12} color={COLORS.warning} />
        </View>
      )}
    </TouchableOpacity>
  );
});

// ── PHASE 4 FIX: React.memo wrapper — ThumbnailStrip will not re-render when ScannerScreen
// re-renders for unrelated reasons. Re-renders only when pages array or callbacks change.
const ThumbnailStripBase: React.FC<ThumbnailStripProps> = ({ 
  pages, 
  onPagePress,
  onDeletePress,
}) => {
  if (pages.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No pages scanned yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={pages}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      keyExtractor={(page) => page.id}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={3}
      removeClippedSubviews={true}
      renderItem={({ item: page }) => (
        <ThumbnailItem page={page} onPagePress={onPagePress} />
      )}
    />
  );
};

export const ThumbnailStrip = React.memo(ThumbnailStripBase);
ThumbnailStrip.displayName = 'ThumbnailStrip';

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  emptyContainer: {
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  thumbnail: {
    width: 50,
    height: 70,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
    position: 'relative',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  pageNumberBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  pageNumberText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  blurryBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 2,
    borderRadius: 3,
  },
});
