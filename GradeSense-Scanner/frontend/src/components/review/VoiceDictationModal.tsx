import React from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';

interface VoiceDictationModalProps {
  visible: boolean;
  text: string;
  isRecording: boolean;
  pulseAnim: Animated.Value;
  suggestions: string[];
  onTextChange: (text: string) => void;
  onToggleRecording: () => void;
  onAddSuggestion: (suggestion: string) => void;
  onClose: () => void;
  onInsert: () => void;
}

export function VoiceDictationModal({
  visible,
  text,
  isRecording,
  pulseAnim,
  suggestions,
  onTextChange,
  onToggleRecording,
  onAddSuggestion,
  onClose,
  onInsert,
}: VoiceDictationModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Voice Dictation Assistant</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.waveformContainer}>
            <Animated.View
              style={[
                styles.micPulseCircle,
                { transform: [{ scale: pulseAnim }], opacity: isRecording ? 0.3 : 0.1 },
              ]}
            />
            <TouchableOpacity
              style={[styles.micBigButton, isRecording && styles.micBigButtonActive]}
              onPress={onToggleRecording}
              activeOpacity={0.85}
            >
              <Ionicons name={isRecording ? 'mic' : 'mic-off'} size={36} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.dictationStatus}>
              {isRecording ? 'Listening... Speak now' : 'Tap microphone to dictate'}
            </Text>
          </View>

          <Text style={styles.suggestionsTitle}>AI SMART-SUGGESTIONS</Text>
          <View style={styles.suggestionsFrame}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
              {suggestions.map(suggestion => (
                <TouchableOpacity
                  key={suggestion}
                  style={styles.suggestionPill}
                  onPress={() => onAddSuggestion(suggestion)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.suggestionPillText}>{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.previewInputBox}>
            <TextInput
              style={styles.previewTextInput}
              value={text}
              onChangeText={onTextChange}
              multiline
              placeholder="Dictated text will appear here. Tap suggestions to insert instantly, or edit manually..."
              placeholderTextColor={COLORS.textMuted}
              textAlignVertical="top"
            />
            {text.length > 0 && (
              <TouchableOpacity style={styles.clearPreviewButton} onPress={() => onTextChange('')}>
                <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.insertButton} onPress={onInsert}>
              <Ionicons name="checkmark-sharp" size={18} color="#fff" />
              <Text style={styles.insertText}>Insert Comment</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  waveformContainer: {
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    height: 160,
    justifyContent: 'center',
    marginBottom: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  micPulseCircle: {
    backgroundColor: COLORS.primary,
    borderRadius: 50,
    height: 100,
    position: 'absolute',
    width: 100,
  },
  micBigButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 36,
    elevation: 5,
    height: 72,
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: 72,
    zIndex: 2,
  },
  micBigButtonActive: {
    backgroundColor: '#E53935',
    shadowColor: '#E53935',
  },
  dictationStatus: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 14,
  },
  suggestionsTitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  suggestionsFrame: {
    height: 42,
  },
  suggestionsScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  suggestionPill: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: `${COLORS.primary}15`,
    borderRadius: 18,
    borderWidth: 1,
    height: 32,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  suggestionPillText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  previewInputBox: {
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 20,
    minHeight: 100,
    padding: 12,
    position: 'relative',
  },
  previewTextInput: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    paddingRight: 20,
  },
  clearPreviewButton: {
    padding: 4,
    position: 'absolute',
    right: 10,
    top: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderColor: '#E0E0E0',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  cancelText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  insertButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    flex: 2,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  insertText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
