import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';

interface TeacherNoteEditorModalProps {
  visible: boolean;
  initialValue: string;
  questionNumber: string | number;
  onClose: () => void;
  onSave: (note: string) => void;
}

export function TeacherNoteEditorModal({
  visible,
  initialValue,
  questionNumber,
  onClose,
  onSave,
}: TeacherNoteEditorModalProps) {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setDraft(initialValue);
    }
  }, [initialValue, visible]);

  const handleSave = () => {
    onSave(draft.trim());
  };

  return (
    <Modal
      animationType="slide"
      transparent
      statusBarTranslucent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.keyboardRoot}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>Teacher note</Text>
                <Text style={styles.title}>Question {questionNumber}</Text>
              </View>
              <TouchableOpacity style={styles.iconButton} onPress={onClose} activeOpacity={0.75}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.body}
            >
              <TextInput
                autoFocus
                multiline
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a correction, override reason, or reusable grading note..."
                placeholderTextColor={COLORS.textMuted}
                style={styles.input}
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={handleSave} activeOpacity={0.85}>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.primaryButtonText}>Save Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.46)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  keyboardRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: COLORS.border,
    borderRadius: 999,
    height: 5,
    marginTop: 10,
    width: 48,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  headerText: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  body: {
    flexGrow: 1,
    padding: 18,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 23,
    minHeight: 160,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actions: {
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: COLORS.textLight,
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
