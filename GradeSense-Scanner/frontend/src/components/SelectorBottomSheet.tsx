import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config';

interface SelectorItem {
  id: string;
  name: string;
  subtitle?: string;
}

interface SelectorBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  data: SelectorItem[];
  selectedValueId?: string | null;
  onSelect: (item: SelectorItem) => void;
  onCreateNew?: () => void;
  createLabel?: string;
  mode: 'subject' | 'batch';
  onEditSubject?: (id: string, newName: string) => Promise<void>;
  onDeleteSubject?: (id: string) => Promise<void>;
  onMergeSubject?: (sourceId: string, destId: string) => Promise<void>;
}

export const SelectorBottomSheet: React.FC<SelectorBottomSheetProps> = ({
  visible,
  onClose,
  title,
  placeholder,
  data,
  selectedValueId,
  onSelect,
  onCreateNew,
  createLabel = 'Create New',
  mode,
  onEditSubject,
  onDeleteSubject,
  onMergeSubject,
}) => {
  const [search, setSearch] = useState('');
  
  // Subject Management States
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [mergingSource, setMergingSource] = useState<SelectorItem | null>(null);

  // Search Filter
  const filteredData = data.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  // Edit / Rename trigger
  const handleStartEdit = (item: SelectorItem) => {
    setEditingId(item.id);
    setEditName(item.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) {
      Alert.alert('Required', 'Subject name cannot be empty');
      return;
    }
    if (onEditSubject) {
      try {
        await onEditSubject(id, editName.trim());
        setEditingId(null);
        setEditName('');
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to rename subject');
      }
    }
  };

  // Delete Action
  const handleDelete = (item: SelectorItem) => {
    Alert.alert(
      'Delete Subject',
      `Are you sure you want to delete "${item.name}"? Existing exams of this subject will become unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (onDeleteSubject) {
              try {
                await onDeleteSubject(item.id);
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Failed to delete subject');
              }
            }
          },
        },
      ]
    );
  };

  // Merge Flow
  const handleStartMerge = (item: SelectorItem) => {
    setMergingSource(item);
  };

  const handleConfirmMerge = (destItem: SelectorItem) => {
    if (!mergingSource) return;
    Alert.alert(
      'Merge Subjects',
      `This will merge all exams from "${mergingSource.name}" into "${destItem.name}", and permanently delete "${mergingSource.name}". Do you want to proceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'default',
          onPress: async () => {
            if (onMergeSubject) {
              try {
                await onMergeSubject(mergingSource.id, destItem.id);
                setMergingSource(null);
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Failed to merge subjects');
              }
            }
          },
        },
      ]
    );
  };

  const handleClose = () => {
    setSearch('');
    setEditingId(null);
    setMergingSource(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.backdropTapArea}
          onPress={handleClose}
        />

        <View style={styles.sheetContainer}>
          {/* Header Indicator */}
          <View style={styles.dragIndicator} />

          {/* Header Title */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.headerBackBtn}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {mergingSource ? 'Select Merge Destination' : title}
            </Text>
            {onCreateNew && !mergingSource ? (
              <TouchableOpacity onPress={onCreateNew} style={styles.headerCreateBtn}>
                <Ionicons name="add" size={20} color={COLORS.primary} style={{ marginRight: 2 }} />
                <Text style={styles.createLabelText}>{createLabel}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
          </View>

          {/* Search bar */}
          {!mergingSource && (
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color={COLORS.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder={placeholder}
                placeholderTextColor={COLORS.textMuted}
                clearButtonMode="while-editing"
              />
            </View>
          )}

          {/* Merging Header Banner */}
          {mergingSource && (
            <View style={styles.mergeBanner}>
              <Ionicons name="git-merge-outline" size={20} color="#00796B" style={{ marginRight: 8 }} />
              <Text style={styles.mergeBannerText}>
                Merging: <Text style={{ fontWeight: '700' }}>{mergingSource.name}</Text>
              </Text>
              <TouchableOpacity
                onPress={() => setMergingSource(null)}
                style={styles.cancelMergeBtn}
              >
                <Text style={styles.cancelMergeText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* List items */}
          <FlatList
            data={mergingSource ? data.filter(item => item.id !== mergingSource.id) : filteredData}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No items found</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = selectedValueId === item.id;
              const isEditing = editingId === item.id;

              if (mergingSource) {
                // Merging Destination Selection Row
                return (
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => handleConfirmMerge(item)}
                  >
                    <Ionicons name="log-in-outline" size={20} color={COLORS.textMuted} style={{ marginRight: 12 }} />
                    <View style={styles.rowInfo}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      {item.subtitle && <Text style={styles.itemSubtitle}>{item.subtitle}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                );
              }

              return (
                <View style={[styles.rowContainer, isSelected && styles.rowContainerSelected]}>
                  {isEditing ? (
                    // Editing / Renaming Mode Row
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        value={editName}
                        onChangeText={setEditName}
                        autoFocus
                      />
                      <TouchableOpacity
                        onPress={() => handleSaveEdit(item.id)}
                        style={styles.saveBtn}
                      >
                        <Text style={styles.saveBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEditingId(null)}
                        style={styles.cancelBtn}
                      >
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    // Regular Display Row
                    <TouchableOpacity
                      style={styles.rowTapArea}
                      onPress={() => {
                        onSelect(item);
                        handleClose();
                      }}
                    >
                      <Ionicons
                        name={mode === 'subject' ? 'book-outline' : 'people-outline'}
                        size={20}
                        color={isSelected ? COLORS.primary : COLORS.textMuted}
                        style={{ marginRight: 12 }}
                      />
                      <View style={styles.rowInfo}>
                        <Text style={[styles.itemName, isSelected && styles.itemNameSelected]}>
                          {item.name}
                        </Text>
                        {item.subtitle ? (
                          <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
                        ) : null}
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  )}

                  {/* Actions (Only visible for Subject mode when not editing) */}
                  {mode === 'subject' && !isEditing && (
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        onPress={() => handleStartEdit(item)}
                        style={styles.actionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <Ionicons name="pencil-outline" size={18} color={COLORS.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleStartMerge(item)}
                        style={styles.actionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <Ionicons name="git-merge-outline" size={18} color="#00796B" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(item)}
                        style={styles.actionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdropTapArea: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    minHeight: '50%',
    paddingBottom: 24,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBackBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    flex: 1,
  },
  headerCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  createLabelText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0F2F1',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  mergeBannerText: {
    color: '#00796B',
    fontSize: 14,
    flex: 1,
  },
  cancelMergeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  cancelMergeText: {
    color: '#00796B',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 12,
  },
  rowContainerSelected: {
    backgroundColor: '#FAF5FF',
  },
  rowTapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  itemNameSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  itemSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    color: COLORS.text,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  cancelBtn: {
    backgroundColor: '#E0E0E0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelBtnText: {
    color: '#333',
    fontSize: 12,
    fontWeight: '600',
  },
});
