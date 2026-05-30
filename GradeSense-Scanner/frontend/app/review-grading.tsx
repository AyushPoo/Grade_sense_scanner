import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../src/config';
import { useAuthStore } from '../src/store/authStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SubmissionListItem {
  id: string;
  studentName: string;
  studentRollNumber: string;
  totalScore: number;
  totalMarks: number;
  status: string;
}

interface ScoreItem {
  id: string;
  questionNumber: string;
  obtainedMarks: number;
  maxMarks: number;
  questionText: string;
  aiFeedback: string | null;
  teacherCorrection: string | null;
}

interface FileItem {
  id: string;
  signedUrl: string | null;
  annotationSignedUrl: string | null;
}

export default function ReviewGradingScreen() {
  const router = useRouter();
  const { examId, sessionName } = useLocalSearchParams<{ examId: string; sessionName?: string }>();
  const token = useAuthStore(state => state.sessionToken);
  const webappUrl = process.env.EXPO_PUBLIC_WEBAPP_URL;

  // List of all submissions for the exam
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [currentSubIndex, setCurrentSubIndex] = useState(0);
  const [isLoadingList, setIsLoadingList] = useState(true);

  // Active submission details
  const [activeSubmission, setActiveSubmission] = useState<any>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [scores, setScores] = useState<ScoreItem[]>([]);
  const [teacherFeedback, setTeacherFeedback] = useState('');
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<'sheet' | 'rubric'>('sheet');
  const [activeScoreIndex, setActiveScoreIndex] = useState(0);

  // Voice dictation state
  const [showDictationModal, setShowDictationModal] = useState(false);
  const [dictationText, setDictationText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Voice dictation pulsing animation
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const startVoiceDictation = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (_) {}
    setDictationText(activeScore?.teacherCorrection || '');
    setShowDictationModal(true);
    setIsRecording(true);
  };

  const stopVoiceDictation = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (_) {}
    setIsRecording(false);
  };

  const handleInsertDictation = async () => {
    if (activeScore) {
      handleCommentChange(activeScore.id, dictationText);
    }
    setShowDictationModal(false);
    setIsRecording(false);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_) {}
  };

  const getAICommentSuggestions = () => {
    if (!activeScore) return [];
    const obtained = activeScore.obtainedMarks;
    const max = activeScore.maxMarks;
    
    if (obtained === max) {
      return [
        "Excellent and well-structured answer.",
        "Correct formula and accurate step-by-step solution.",
        "Brilliant conceptual clarity and presentation.",
        "Precise explanation with correct examples."
      ];
    } else if (obtained === 0) {
      return [
        "Incorrect attempt. Please review the model answer.",
        "Formula is wrong, leading to completely incorrect calculation.",
        "Concept not understood. Let's discuss this in class.",
        "Blank or non-responsive answer sheet."
      ];
    } else {
      return [
        "Good attempt, but missing some key definition points.",
        "Steps are correct, but calculation error in the final step.",
        "Please elaborate more on the core concept in future answers.",
        "Definition is correct but missing the diagram or application."
      ];
    }
  };

  // Fetch all submissions on mount
  useEffect(() => {
    if (!examId || !token || !webappUrl) return;

    const fetchSubmissionsList = async () => {
      try {
        setIsLoadingList(true);
        const res = await fetch(`${webappUrl}/api/v1/exams/${examId}/submissions`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Bypass-Tunnel-Reminder': 'true',
          },
        });
        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }
        const json = await res.json();
        const list: SubmissionListItem[] = json.data || [];
        setSubmissions(list);
        if (list.length > 0) {
          setCurrentSubIndex(0);
        }
      } catch (err: any) {
        console.error('Failed to fetch submissions list:', err);
        Alert.alert('Error', `Failed to load student list: ${err.message}`);
      } finally {
        setIsLoadingList(false);
      }
    };

    fetchSubmissionsList();
  }, [examId]);

  // Fetch active submission detail when currentSubIndex changes
  useEffect(() => {
    if (submissions.length === 0 || !token || !webappUrl) return;
    const activeSub = submissions[currentSubIndex];
    if (!activeSub) return;

    const fetchDetail = async () => {
      try {
        setIsLoadingDetail(true);
        const res = await fetch(`${webappUrl}/api/v1/submissions/${activeSub.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Bypass-Tunnel-Reminder': 'true',
          },
        });
        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }
        const json = await res.json();
        const data = json.data || {};
        setActiveSubmission(data.submission);
        setFiles(data.files || []);
        setScores(data.scores || []);
        setTeacherFeedback(data.submission?.teacherFeedback || '');
        if ((data.scores || []).length > 0) {
          setActiveScoreIndex(0);
        }
      } catch (err: any) {
        console.error('Failed to fetch submission detail:', err);
        Alert.alert('Error', `Failed to load details: ${err.message}`);
      } finally {
        setIsLoadingDetail(false);
      }
    };

    fetchDetail();
  }, [currentSubIndex, submissions]);

  const handleScoreChange = (scoreId: string, obtained: number) => {
    setScores(prev =>
      prev.map(s =>
        s.id === scoreId
          ? { ...s, obtainedMarks: Math.max(0, Math.min(obtained, s.maxMarks)) }
          : s
      )
    );
  };

  const handleCommentChange = (scoreId: string, comment: string) => {
    setScores(prev =>
      prev.map(s => (s.id === scoreId ? { ...s, teacherCorrection: comment } : s))
    );
  };

  const handleSaveAndNext = async () => {
    if (submissions.length === 0 || !token || !webappUrl) return;
    const activeSub = submissions[currentSubIndex];
    if (!activeSub) return;

    try {
      setIsSaving(true);
      const reviewPayload = {
        teacherFeedback,
        scores: scores.map(s => ({
          id: s.id,
          obtainedMarks: s.obtainedMarks,
          teacherCorrection: s.teacherCorrection || undefined,
        })),
      };

      const res = await fetch(`${webappUrl}/api/v1/submissions/${activeSub.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Bypass-Tunnel-Reminder': 'true',
        },
        body: JSON.stringify(reviewPayload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Status ${res.status}`);
      }

      // Update enqueued list scores locally for snappy UI
      const updatedList = [...submissions];
      const totalScore = scores.reduce((sum, s) => sum + s.obtainedMarks, 0);
      updatedList[currentSubIndex] = {
        ...activeSub,
        totalScore,
        status: 'reviewed',
      };
      setSubmissions(updatedList);

      if (currentSubIndex < submissions.length - 1) {
        setCurrentSubIndex(prev => prev + 1);
      } else {
        Alert.alert('Completed!', 'You have reviewed all student submissions for this exam.');
      }
    } catch (err: any) {
      console.error('Failed to submit review:', err);
      Alert.alert('Error', `Failed to save review: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const activeSub = submissions[currentSubIndex];
  const activeScore = scores[activeScoreIndex];

  if (isLoadingList) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading enqueued student papers...</Text>
      </SafeAreaView>
    );
  }

  if (submissions.length === 0) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{sessionName || 'Review Grades'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="folder-open-outline" size={80} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No Papers Enqueued</Text>
          <Text style={styles.emptySubtitle}>No graded student papers are associated with this exam yet.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{sessionName || 'Grading Review'}</Text>
          <Text style={styles.headerSubtitle}>
            Student {currentSubIndex + 1} of {submissions.length}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Student Switcher Row */}
      <View style={styles.studentSwitcher}>
        <TouchableOpacity
          style={[styles.switchArrow, currentSubIndex === 0 && styles.switchArrowDisabled]}
          onPress={() => currentSubIndex > 0 && setCurrentSubIndex(prev => prev - 1)}
          disabled={currentSubIndex === 0}
        >
          <Ionicons name="chevron-back" size={22} color={currentSubIndex === 0 ? COLORS.textMuted : COLORS.primary} />
        </TouchableOpacity>

        <View style={styles.studentDetails}>
          <Text style={styles.studentName}>{activeSub?.studentName || 'Unknown Student'}</Text>
          <Text style={styles.studentRoll}>Roll: {activeSub?.studentRollNumber || 'N/A'}</Text>
        </View>

        <TouchableOpacity
          style={[styles.switchArrow, currentSubIndex === submissions.length - 1 && styles.switchArrowDisabled]}
          onPress={() => currentSubIndex < submissions.length - 1 && setCurrentSubIndex(prev => prev + 1)}
          disabled={currentSubIndex === submissions.length - 1}
        >
          <Ionicons name="chevron-forward" size={22} color={currentSubIndex === submissions.length - 1 ? COLORS.textMuted : COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sheet' && styles.activeTab]}
          onPress={() => setActiveTab('sheet')}
        >
          <Ionicons name="document-text" size={18} color={activeTab === 'sheet' ? COLORS.primary : COLORS.textLight} />
          <Text style={[styles.tabText, activeTab === 'sheet' && styles.activeTabText]}>Answer Sheet</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'rubric' && styles.activeTab]}
          onPress={() => setActiveTab('rubric')}
        >
          <Ionicons name="bulb" size={18} color={activeTab === 'rubric' ? COLORS.primary : COLORS.textLight} />
          <Text style={[styles.tabText, activeTab === 'rubric' && styles.activeTabText]}>Rubric & AI</Text>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      {isLoadingDetail ? (
        <View style={styles.detailLoading}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.detailLoadingText}>Fetching student paper files...</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {activeTab === 'sheet' ? (
            // Tab 1: Answer Sheet View
            <View style={styles.imageViewerContainer}>
              {files.length > 0 && files[0].signedUrl ? (
                <Image
                  source={{ uri: files[0].signedUrl }}
                  style={styles.sheetImage}
                  contentFit="contain"
                />
              ) : (
                <View style={styles.noImageView}>
                  <Ionicons name="image-outline" size={60} color={COLORS.textMuted} />
                  <Text style={styles.noImageText}>Scanned paper image not loaded</Text>
                </View>
              )}
            </View>
          ) : (
            // Tab 2: Question & Rubric list View
            <View style={styles.questionsViewContainer}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.scrollSectionTitle}>QUESTIONS LIST</Text>
                {scores.map((score, index) => (
                  <TouchableOpacity
                    key={score.id}
                    style={[
                      styles.questionRowItem,
                      activeScoreIndex === index && styles.activeQuestionRowItem,
                    ]}
                    onPress={() => setActiveScoreIndex(index)}
                  >
                    <View style={styles.questionRowLeft}>
                      <Text style={[styles.qNumText, activeScoreIndex === index && { color: COLORS.primary }]}>
                        Q{score.questionNumber}
                      </Text>
                      <Text style={styles.qScoreText}>
                        Marks: {score.obtainedMarks} / {score.maxMarks}
                      </Text>
                    </View>
                    <Ionicons
                      name={activeScoreIndex === index ? 'chevron-down' : 'chevron-forward'}
                      size={18}
                      color={COLORS.textMuted}
                    />
                  </TouchableOpacity>
                ))}

                {activeScore && (
                  <View style={styles.questionDetailsCard}>
                    <Text style={styles.detailsCardQNum}>Question {activeScore.questionNumber}</Text>
                    <Text style={styles.detailsCardText}>
                      {activeScore.questionText || 'No question text extracted.'}
                    </Text>

                    {activeScore.aiFeedback && (
                      <View style={styles.aiFeedbackBox}>
                        <View style={styles.aiFeedbackHeader}>
                          <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                          <Text style={styles.aiFeedbackTitle}>AI Evaluation Feedback</Text>
                        </View>
                        <Text style={styles.aiFeedbackText}>{activeScore.aiFeedback}</Text>
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          )}

          {/* Stepper & Bottom Control panel */}
          {activeScore && (
            <View style={styles.bottomControlPanel}>
              <View style={styles.stepperRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bottomQTitle}>Question {activeScore.questionNumber}</Text>
                  <Text style={styles.bottomQMax}>Max Marks: {activeScore.maxMarks}</Text>
                </View>

                <View style={styles.stepperContainer}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => handleScoreChange(activeScore.id, activeScore.obtainedMarks - 0.5)}
                  >
                    <Ionicons name="remove" size={20} color={COLORS.primary} />
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{activeScore.obtainedMarks.toFixed(1)}</Text>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => handleScoreChange(activeScore.id, activeScore.obtainedMarks + 0.5)}
                  >
                    <Ionicons name="add" size={20} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Comment text input with Voice dictation trigger */}
              <View style={styles.commentInputRow}>
                <View style={styles.commentInputContainer}>
                  <TextInput
                    style={styles.commentInput}
                    value={activeScore.teacherCorrection || ''}
                    onChangeText={(val) => handleCommentChange(activeScore.id, val)}
                    placeholder="Add custom marks override comment..."
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />
                </View>
                <TouchableOpacity
                  style={styles.micInputBtn}
                  onPress={startVoiceDictation}
                  activeOpacity={0.75}
                >
                  <Ionicons name="mic-outline" size={22} color={COLORS.primary} />
                </TouchableOpacity>
              </View>

              {/* Save & Approve CTA */}
              <TouchableOpacity
                style={[styles.saveNextBtn, isSaving && { backgroundColor: COLORS.textMuted }]}
                onPress={handleSaveAndNext}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={22} color="#fff" />
                    <Text style={styles.saveNextBtnText}>
                      {currentSubIndex === submissions.length - 1 ? 'APPROVE & FINISH' : 'APPROVE & NEXT STUDENT'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Voice Dictation Modal */}
      <Modal
        visible={showDictationModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDictationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.dictationModalHeader}>
              <Text style={styles.modalTitle}>Voice Dictation Assistant</Text>
              <TouchableOpacity onPress={() => setShowDictationModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {/* Pulsing Mic Visualization */}
            <View style={styles.waveformContainer}>
              <Animated.View style={[
                styles.micPulseCircle,
                { transform: [{ scale: pulseAnim }], opacity: isRecording ? 0.3 : 0.1 }
              ]} />
              <TouchableOpacity
                style={[styles.micBigBtn, isRecording && styles.micBigBtnActive]}
                onPress={() => isRecording ? stopVoiceDictation() : setIsRecording(true)}
              >
                <Ionicons name={isRecording ? "mic" : "mic-off"} size={36} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.dictationStatus}>
                {isRecording ? "Listening... Speak now" : "Tap microphone to dictate"}
              </Text>
            </View>

            {/* Smart Suggested Comments */}
            <Text style={styles.suggestionsTitle}>AI Smart-Suggestions</Text>
            <View style={{ height: 42 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                {getAICommentSuggestions().map((suggestion, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.suggestionPill}
                    onPress={async () => {
                      try {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      } catch (_) {}
                      setDictationText(prev => prev ? `${prev} ${suggestion}` : suggestion);
                    }}
                  >
                    <Text style={styles.suggestionPillText}>{suggestion}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Live Text Preview Box */}
            <View style={styles.previewInputBox}>
              <TextInput
                style={styles.previewTextInput}
                value={dictationText}
                onChangeText={setDictationText}
                multiline
                placeholder="Dictated text will appear here. Tap suggestions to insert instantly, or edit manually..."
                placeholderTextColor={COLORS.textMuted}
              />
              {dictationText.length > 0 && (
                <TouchableOpacity
                  style={styles.clearPreviewBtn}
                  onPress={() => setDictationText('')}
                >
                  <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Action buttons */}
            <View style={styles.dictationActions}>
              <TouchableOpacity
                style={styles.dictationCancelBtn}
                onPress={() => setShowDictationModal(false)}
              >
                <Text style={styles.dictationCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dictationSaveBtn}
                onPress={handleInsertDictation}
              >
                <Ionicons name="checkmark-sharp" size={18} color="#fff" />
                <Text style={styles.dictationSaveText}>Insert Comment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 15,
    color: COLORS.textLight,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 18,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  // Student Switcher
  studentSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  switchArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  switchArrowDisabled: {
    opacity: 0.5,
    backgroundColor: '#EAEAEA',
  },
  studentDetails: {
    alignItems: 'center',
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  studentRoll: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  // Tabs
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  activeTabText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  // Loading Details
  detailLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textLight,
  },
  // Tab 1: Image View
  imageViewerContainer: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetImage: {
    width: '100%',
    height: '100%',
  },
  noImageView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageText: {
    color: '#999',
    fontSize: 14,
    marginTop: 10,
  },
  // Tab 2: Questions list
  questionsViewContainer: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  scrollSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  questionRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeQuestionRowItem: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}0D`,
  },
  questionRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  qNumText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  qScoreText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  questionDetailsCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  detailsCardQNum: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  detailsCardText: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 16,
  },
  aiFeedbackBox: {
    backgroundColor: `${COLORS.primary}0D`,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: `${COLORS.primary}1A`,
  },
  aiFeedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  aiFeedbackTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  aiFeedbackText: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  // Bottom control panel
  bottomControlPanel: {
    backgroundColor: COLORS.cardBg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 10,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bottomQTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  bottomQMax: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    paddingHorizontal: 4,
    backgroundColor: COLORS.backgroundDark,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  stepperValue: {
    width: 50,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  commentInputContainer: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  commentInput: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 44,
  },
  micInputBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${COLORS.primary}20`,
  },
  saveNextBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 16,
  },
  saveNextBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Dictation Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  dictationModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  waveformContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    marginBottom: 18,
    position: 'relative',
    overflow: 'hidden',
  },
  micPulseCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
  },
  micBigBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 2,
  },
  micBigBtnActive: {
    backgroundColor: '#E53935',
    shadowColor: '#E53935',
  },
  dictationStatus: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  suggestionsScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  suggestionPill: {
    backgroundColor: COLORS.primaryXLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginRight: 8,
    height: 32,
    borderWidth: 1,
    borderColor: `${COLORS.primary}15`,
  },
  suggestionPillText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  previewInputBox: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    minHeight: 100,
    marginBottom: 20,
    position: 'relative',
  },
  previewTextInput: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    paddingRight: 20,
  },
  clearPreviewBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 4,
  },
  dictationActions: {
    flexDirection: 'row',
    gap: 12,
  },
  dictationCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  dictationCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  dictationSaveBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dictationSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
