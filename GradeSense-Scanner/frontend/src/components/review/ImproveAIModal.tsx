import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../config';
import type { ScoreItem } from '../../types/review';
import { styles } from './ImproveAIModal.styles';

interface ImproveAIModalProps {
  visible: boolean;
  score: ScoreItem | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (expectedGrade: number, teacherCorrection: string, options: { regradeAll: boolean; applyGlobally: boolean }) => void;
}

export function ImproveAIModal({
  visible,
  score,
  isSubmitting,
  onClose,
  onSubmit,
}: ImproveAIModalProps) {
  const [expectedGrade, setExpectedGrade] = useState('');
  const [teacherCorrection, setTeacherCorrection] = useState('');
  const [regradeAll, setRegradeAll] = useState(false);
  const [applyGlobally, setApplyGlobally] = useState(false);

  useEffect(() => {
    if (visible && score) {
      setExpectedGrade(String(score.obtainedMarks));
      setTeacherCorrection(score.teacherCorrection || '');
      setRegradeAll(false);
      setApplyGlobally(false);
    }
  }, [score, visible]);

  const expectedGradeNumber = useMemo(() => Number(expectedGrade), [expectedGrade]);
  const isValid = Boolean(
    score &&
    Number.isFinite(expectedGradeNumber) &&
    expectedGradeNumber >= 0 &&
    expectedGradeNumber <= score.maxMarks &&
    teacherCorrection.trim()
  );

  if (!score) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="bulb-outline" size={20} color={COLORS.primary} />
              <Text style={styles.title}>Improve AI Grading</Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={isSubmitting} style={styles.iconButton}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.questionBox}>
              <Text style={styles.questionTitle}>Question {score.questionNumber}</Text>
              <Text style={styles.questionText}>{score.questionText || 'No question text extracted.'}</Text>
            </View>

            <View style={styles.gradeRow}>
              <View style={styles.gradeCard}>
                <Text style={styles.fieldLabel}>AI Grade</Text>
                <Text style={styles.gradeValue}>{score.obtainedMarks} / {score.maxMarks}</Text>
              </View>
              <View style={styles.gradeCard}>
                <Text style={styles.fieldLabel}>Expected Grade</Text>
                <TextInput
                  value={expectedGrade}
                  onChangeText={setExpectedGrade}
                  keyboardType="decimal-pad"
                  style={styles.gradeInput}
                  editable={!isSubmitting}
                  selectTextOnFocus
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>AI Feedback</Text>
              <TextInput
                value={score.aiFeedback || 'No AI feedback is available for this question.'}
                multiline
                editable={false}
                style={[styles.textArea, styles.readOnlyArea]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Your Correction / Feedback *</Text>
              <TextInput
                value={teacherCorrection}
                onChangeText={setTeacherCorrection}
                multiline
                editable={!isSubmitting}
                placeholder="Tell the AI what was wrong and what to do next time for this type of answer."
                placeholderTextColor={COLORS.textMuted}
                style={styles.textArea}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.optionCard}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Regrade all papers</Text>
                <Text style={styles.optionSubtitle}>Apply this correction to this exam after saving.</Text>
              </View>
              <Switch
                value={regradeAll}
                onValueChange={setRegradeAll}
                disabled={isSubmitting}
                trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                thumbColor={regradeAll ? COLORS.primary : '#f4f3f4'}
              />
            </View>

            <View style={styles.optionCard}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Apply globally</Text>
                <Text style={styles.optionSubtitle}>Save this as an AI Brain rule for future exams.</Text>
              </View>
              <Switch
                value={applyGlobally}
                onValueChange={setApplyGlobally}
                disabled={isSubmitting}
                trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                thumbColor={applyGlobally ? COLORS.primary : '#f4f3f4'}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={isSubmitting}
              activeOpacity={0.82}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, (!isValid || isSubmitting) && styles.submitButtonDisabled]}
              onPress={() => onSubmit(expectedGradeNumber, teacherCorrection, { regradeAll, applyGlobally })}
              disabled={!isValid || isSubmitting}
              activeOpacity={0.82}
            >
              {isSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />}
              <Text style={styles.submitText}>Submit Correction</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
