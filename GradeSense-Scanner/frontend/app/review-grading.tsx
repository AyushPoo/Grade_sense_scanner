import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { COLORS, getBackendUrl } from '../src/config';
import { useAuthStore } from '../src/store/authStore';
import { useScanStore } from '../src/store/scanStore';
import { GradingControlPanel } from '../src/components/review/GradingControlPanel';
import { PaperFileViewer } from '../src/components/review/PaperFileViewer';
import { RubricReviewPanel } from '../src/components/review/RubricReviewPanel';
import { VoiceDictationModal } from '../src/components/review/VoiceDictationModal';
import { ReviewSettingsSheet } from '../src/components/review/ReviewSettingsSheet';
import { StudentAnswerSheetPanel } from '../src/components/review/StudentAnswerSheetPanel';
import { ImproveAIModal } from '../src/components/review/ImproveAIModal';
import type { ReviewFileItem, ReviewFileSlide, ScoreItem, SubmissionListItem } from '../src/types/review';
import { buildLocalReviewFiles, buildReviewFileSlides, mergeReviewFiles } from '../src/utils/reviewFiles';
import { normalizeReviewScores } from '../src/utils/reviewScores';
import { DEFAULT_REVIEW_SETTINGS, ReviewSettings } from '../src/utils/reviewSettings';
import { submitQuestionImprovement } from '../src/api/improveAI';
import {
  fetchExamReviewSettings,
  flagExamGrading,
  updateExamReviewSettings,
} from '../src/api/reviewSettings';

export default function ReviewGradingScreen() {
  const router = useRouter();
  const { examId, sessionName } = useLocalSearchParams<{ examId: string; sessionName?: string }>();
  const token = useAuthStore(state => state.sessionToken);
  const savedSessions = useScanStore(state => state.savedSessions);
  const webappUrl = getBackendUrl();
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showImproveAIModal, setShowImproveAIModal] = useState(false);
  const [isFlaggingGrading, setIsFlaggingGrading] = useState(false);
  const [isSubmittingImprovement, setIsSubmittingImprovement] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [reviewSettings, setReviewSettings] = useState<ReviewSettings>(DEFAULT_REVIEW_SETTINGS);
  const [settingsSyncStatus, setSettingsSyncStatus] = useState<'idle' | 'loaded' | 'unavailable'>('idle');

  const handleReevaluate = () => {
    if (!examId || !token) return;
    
    Alert.alert(
      'Reevaluate Exam?',
      'This will queue all student papers in this exam to be re-graded by the AI with the selected grading mode. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reevaluate', 
          onPress: async () => {
            setIsReevaluating(true);
            try {
              const res = await fetch(`${getBackendUrl()}/api/v1/exams/${examId}/regrade`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              });
              if (res.ok) {
                Alert.alert('Success', 'AI reevaluation enqueued successfully! It will run in the background and update shortly.');
              } else {
                const txt = await res.text();
                Alert.alert('Failed', `Could not trigger reevaluation: ${txt}`);
              }
            } catch (err: any) {
              Alert.alert('Error', `Network request failed: ${err.message}`);
            } finally {
              setIsReevaluating(false);
            }
          }
        }
      ]
    );
  };

  // List of all submissions for the exam
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [currentSubIndex, setCurrentSubIndex] = useState(0);
  const [isLoadingList, setIsLoadingList] = useState(true);

  // Active submission details
  const [files, setFiles] = useState<ReviewFileItem[]>([]);
  const [scores, setScores] = useState<ScoreItem[]>([]);
  const [teacherFeedback, setTeacherFeedback] = useState('');
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<'sheet' | 'rubric'>('sheet');
  const [sheetMode, setSheetMode] = useState<'answer' | 'files'>('answer');
  const [activeScoreIndex, setActiveScoreIndex] = useState(0);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [failedImageIds, setFailedImageIds] = useState<Record<string, boolean>>({});

  // Voice dictation state
  const [showDictationModal, setShowDictationModal] = useState(false);
  const [dictationText, setDictationText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const activeSub = submissions[currentSubIndex];
  const activeSubId = activeSub?.id;
  const activeScore = scores[activeScoreIndex];
  const localSession = useMemo(
    () => savedSessions.find(session => session.exam_id === examId),
    [examId, savedSessions]
  );
  const localFiles = useMemo(
    () => buildLocalReviewFiles(localSession, activeSub),
    [activeSub, localSession]
  );
  const reviewFiles = useMemo(
    () => mergeReviewFiles(files, localFiles),
    [files, localFiles]
  );
  const fileSlides = useMemo(
    () => buildReviewFileSlides(reviewFiles),
    [reviewFiles]
  );

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
  }, [isRecording, pulseAnim]);

  const startVoiceDictation = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
    setDictationText(activeScore?.teacherCorrection || '');
    setShowDictationModal(true);
    await startSpeechRecognition();
  };

  const stopVoiceDictation = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    ExpoSpeechRecognitionModule.stop();
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
    } catch {}
  };

  const handleCloseDictation = () => {
    ExpoSpeechRecognitionModule.abort();
    setShowDictationModal(false);
    setIsRecording(false);
  };

  const handleToggleDictationRecording = () => {
    if (isRecording) {
      stopVoiceDictation();
    } else {
      startSpeechRecognition();
    }
  };

  const handleAddDictationSuggestion = async (suggestion: string) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setDictationText(prev => prev ? `${prev} ${suggestion}` : suggestion);
  };

  useSpeechRecognitionEvent('start', () => setIsRecording(true));
  useSpeechRecognitionEvent('end', () => setIsRecording(false));
  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript;
    if (transcript) {
      setDictationText(transcript);
    }
  });
  useSpeechRecognitionEvent('error', event => {
    setIsRecording(false);
    Alert.alert('Voice Dictation Failed', event.message || 'Speech recognition is unavailable on this device.');
  });

  const startSpeechRecognition = async () => {
    try {
      const availability = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!availability) {
        Alert.alert('Voice Dictation Unavailable', 'Speech recognition is not available on this device.');
        return;
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone Permission Needed', 'Allow microphone and speech recognition access to use voice comments.');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-IN',
        interimResults: true,
        continuous: false,
      });
    } catch (err: any) {
      setIsRecording(false);
      Alert.alert('Voice Dictation Failed', err.message || 'Could not start speech recognition.');
    }
  };

  useEffect(() => {
    if (!examId || !token || !webappUrl) return;

    const loadSettings = async () => {
      try {
        const settings = await fetchExamReviewSettings({ backendUrl: webappUrl, token, examId });
        setReviewSettings(settings);
        setSettingsSyncStatus('loaded');
      } catch (err) {
        console.error('Failed to fetch synced review settings:', err);
        setSettingsSyncStatus('unavailable');
      }
    };

    loadSettings();
  }, [examId, token, webappUrl]);

  const handleSaveReviewSettings = async (settings: ReviewSettings) => {
    if (!examId || !token || !webappUrl) return;

    setIsSavingSettings(true);
    try {
      const saved = await updateExamReviewSettings({ backendUrl: webappUrl, token, examId }, settings);
      setReviewSettings(saved);
      setSettingsSyncStatus('loaded');
      setShowSettingsSheet(false);
    } catch (err: any) {
      if (err.status === 404 || err.status === 405) {
        Alert.alert('Sync Endpoint Missing', 'The webapp/scanner API needs an exam settings endpoint before mobile can update these synced settings.');
      } else {
        Alert.alert('Save Failed', err.message || 'Could not save review settings.');
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleFlagGrading = async () => {
    if (!examId || !token || !webappUrl) return;

    setIsFlaggingGrading(true);
    try {
      await flagExamGrading({ backendUrl: webappUrl, token, examId }, reviewSettings);
      Alert.alert('Flag Submitted', 'This grading issue was sent for review.');
    } catch (err: any) {
      if (err.status === 404 || err.status === 405) {
        Alert.alert('Not Available Yet', 'AI grading flags need server support before they can be submitted from mobile.');
      } else {
        Alert.alert('Flag Failed', err.message || 'Could not flag grading.');
      }
    } finally {
      setIsFlaggingGrading(false);
    }
  };

  const handleSubmitQuestionImprovement = async (expectedGrade: number, teacherCorrection: string) => {
    if (!activeSubId || !activeScore || !token || !webappUrl) return;

    setIsSubmittingImprovement(true);
    try {
      const result = await submitQuestionImprovement({
        backendUrl: webappUrl,
        token,
        submissionId: activeSubId,
        score: activeScore,
        expectedGrade,
        teacherCorrection,
      });
      setScores(prev => prev.map(score => (score.id === result.score.id ? result.score : score)));
      setShowImproveAIModal(false);
      Alert.alert('Improve AI Saved', 'This correction was saved for this question and future grading.');
    } catch (err: any) {
      if (err.status === 404 || err.status === 405) {
        Alert.alert('Not Available Yet', 'Question-level Improve AI needs the latest scanner backend deployment.');
      } else {
        Alert.alert('Improve AI Failed', err.message || 'Could not save this AI correction.');
      }
    } finally {
      setIsSubmittingImprovement(false);
    }
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
  }, [examId, token, webappUrl]);

  const fetchActiveSubmissionDetail = useCallback(async () => {
    if (!activeSubId || !token || !webappUrl) return;

    try {
      setIsLoadingDetail(true);
      const res = await fetch(`${webappUrl}/api/v1/submissions/${activeSubId}`, {
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
      setFiles(data.files || []);
      setScores(normalizeReviewScores(data.scores || []));
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
  }, [activeSubId, token, webappUrl]);

  // Fetch active submission detail when currentSubIndex changes
  useEffect(() => {
    if (submissions.length === 0) return;
    setActiveFileIndex(0);
    setFailedImageIds({});
    fetchActiveSubmissionDetail();
  }, [fetchActiveSubmissionDetail, submissions.length]);

  useEffect(() => {
    if (activeFileIndex >= fileSlides.length) {
      setActiveFileIndex(0);
    }
  }, [activeFileIndex, fileSlides.length]);

  const handleImageError = useCallback((slideId: string) => {
    setFailedImageIds(prev => ({ ...prev, [slideId]: true }));
  }, []);

  const handleRetryPaperFiles = useCallback(async () => {
    setFailedImageIds({});
    await fetchActiveSubmissionDetail();
  }, [fetchActiveSubmissionDetail]);

  const handleOpenFileType = useCallback((type: ReviewFileSlide['type']) => {
    const index = fileSlides.findIndex(slide => slide.type === type);
    if (index >= 0) {
      setActiveFileIndex(index);
      setSheetMode('files');
    }
  }, [fileSlides]);

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
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setShowSettingsSheet(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          {isReevaluating ? (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginRight: 8 }} />
          ) : (
            <TouchableOpacity
              style={styles.headerRegradeBtn}
              onPress={handleReevaluate}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={13} color="#fff" />
              <Text style={styles.headerRegradeBtnText}>Regrade</Text>
            </TouchableOpacity>
          )}
        </View>
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
            sheetMode === 'answer' ? (
              <StudentAnswerSheetPanel
                activeScore={activeScore}
                fileSlides={fileSlides}
                onOpenFileType={handleOpenFileType}
              />
            ) : (
              <View style={styles.paperFilesContainer}>
                <TouchableOpacity style={styles.answerTextButton} onPress={() => setSheetMode('answer')} activeOpacity={0.82}>
                  <Ionicons name="reader-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.answerTextButtonText}>Back to student answer text</Text>
                </TouchableOpacity>
                <PaperFileViewer
                  slides={fileSlides}
                  activeIndex={activeFileIndex}
                  failedImageIds={failedImageIds}
                  onSelectIndex={setActiveFileIndex}
                  onImageError={handleImageError}
                  onRetry={handleRetryPaperFiles}
                />
              </View>
            )
          ) : (
            <RubricReviewPanel
              scores={scores}
              activeScoreIndex={activeScoreIndex}
              feedbackEnabled={reviewSettings.feedbackEnabled}
              onSelectScore={setActiveScoreIndex}
              onImproveAI={() => setShowImproveAIModal(true)}
              isImprovingAI={isSubmittingImprovement}
            />
          )}

          {activeScore && (
            <GradingControlPanel
              activeScore={activeScore}
              isSaving={isSaving}
              isLastSubmission={currentSubIndex === submissions.length - 1}
              onScoreChange={handleScoreChange}
              onCommentChange={handleCommentChange}
              onOpenDictation={startVoiceDictation}
              onSaveAndNext={handleSaveAndNext}
            />
          )}
        </View>
      )}

      <VoiceDictationModal
        visible={showDictationModal}
        text={dictationText}
        isRecording={isRecording}
        pulseAnim={pulseAnim}
        suggestions={getAICommentSuggestions()}
        onTextChange={setDictationText}
        onToggleRecording={handleToggleDictationRecording}
        onAddSuggestion={handleAddDictationSuggestion}
        onClose={handleCloseDictation}
        onInsert={handleInsertDictation}
      />
      <ReviewSettingsSheet
        visible={showSettingsSheet}
        settings={reviewSettings}
        isFlagging={isFlaggingGrading}
        isSaving={isSavingSettings}
        syncStatusText={settingsSyncStatus === 'loaded' ? 'Synced from webapp' : 'Waiting for webapp settings sync'}
        onClose={() => setShowSettingsSheet(false)}
        onSave={handleSaveReviewSettings}
        onFlagGrading={handleFlagGrading}
      />
      <ImproveAIModal
        visible={showImproveAIModal}
        score={activeScore || null}
        isSubmitting={isSubmittingImprovement}
        onClose={() => setShowImproveAIModal(false)}
        onSubmit={handleSubmitQuestionImprovement}
      />
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
    flex: 1,
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
  paperFilesContainer: {
    flex: 1,
    backgroundColor: '#1E1E1E',
  },
  answerTextButton: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  answerTextButtonText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerIconBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  headerRegradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  headerRegradeBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
});
