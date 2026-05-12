import React from 'react';
import { View, ScrollView, TouchableOpacity, Image, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';
import { ScannedPage } from '../types';

interface ThumbnailStripProps {
  pages: ScannedPage[];
  onPagePress: (page: ScannedPage) => void;
  onDeletePress?: (pageNumber: number) => void;
}

export const ThumbnailStrip: React.FC<ThumbnailStripProps> = ({ 
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
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {pages.map((page) => (
        <TouchableOpacity 
          key={page.page_number} 
          style={styles.thumbnail}
          onPress={() => onPagePress(page)}
          activeOpacity={0.7}
        >
          {page.file_path ? (
            <Image 
              source={{ uri: page.file_path }} 
              style={styles.thumbnailImage} 
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
      ))}
    </ScrollView>
  );
};

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
    resizeMode: 'cover',
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
