import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScanSession, ScanPhase, ScannedPage, ScanSessionSettings, Batch, Subject } from '../types';
import * as FileSystem from 'expo-file-system';
import { getBackendUrl } from '../config';
import { reconcileFetchedScanSessions } from '../utils/sessionReconciliation';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { findReusableDraftSession } from '../utils/sessionDrafts';
import { prepareSessionForScanningPhase } from '../utils/scanContinuation';

// Simple UUID generator
export const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export interface PendingRetake {
  pageId: string;
  studentIndex?: number;
  phase: ScanPhase;
  replaceIndex: number;
  originalPageNumber: number;
  originalFilePath: string;
}

export type QualityLevel = 'green' | 'yellow' | 'red';

export function qualityScore(sharpnessScore: number, isBlurry: boolean): QualityLevel {
  // sharpnessScore is a 0–100 value from blurDetection
  if (!isBlurry && sharpnessScore >= 60) return 'green';
  if (sharpnessScore >= 30) return 'yellow';
  return 'red';
}

interface ScanState {
  // Current session
  currentSession: ScanSession | null;
  currentPhase: ScanPhase;
  currentStudentIndex: number;

  // All saved sessions
  savedSessions: ScanSession[];

  // Deleted session IDs tracker
  deletedSessionIds: string[];

  // Saved batches
  savedBatches: Batch[];

  // Saved subjects
  savedSubjects: Subject[];

  // Scanner state
  isScanning: boolean;
  flashMode: 'off' | 'on' | 'auto';
  autoCaptureEnabled: boolean;
  autoCropEnabled: boolean;
  pendingRetake: PendingRetake | null;
  hasHydrated: boolean;

  // Actions
  addPage: (page: ScannedPage) => void;
  removePage: (pageNumber: number, phase?: string, studentIndex?: number) => void;
  undoLastPage: () => void;
  setCurrentPhase: (phase: 'question_paper' | 'model_answer' | 'students') => void;
  nextStudent: () => void;
  previousStudent: () => void;
  finishSession: () => void;
  saveSession: () => void;
  clearCurrentSession: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSession: (sessionId: string) => void;
  prepareSessionForScanning: (sessionId: string, phase: ScanPhase) => void;
  updateSessionStatus: (sessionId: string, status: ScanSession['status'], progress: number, examId?: string) => void;
  fetchSessions: () => Promise<void>;
  fetchBatches: () => Promise<void>;
  fetchSubjects: () => Promise<void>;
  createBatch: (name: string, studentCount?: number) => Promise<Batch>;
  createSubject: (name: string, classStandard?: string) => Promise<Subject>;
  createSession: (
    name: string,
    batchId: string,
    batchName: string,
    settings: ScanSessionSettings,
    subjectId?: string,
    totalMarks?: number,
    examDate?: string
  ) => Promise<ScanSession>;
  replaceSessionDocuments: (
    sessionId: string,
    documents: {
      questionPaper?: ScannedPage[];
      modelAnswer?: ScannedPage[];
      studentPapers?: ScannedPage[];
    }
  ) => void;
  syncCurrentMetadata: (currentPhase?: 'question_paper' | 'model_answer' | 'student', studentIndex?: number) => Promise<void>;
  updateStudentBarcode: (studentIndex: number, barcodeData: { type: string; data: string; matched_name?: string }) => void;
  setFlashMode: (mode: 'off' | 'on' | 'auto') => void;
  setAutoCaptureEnabled: (enabled: boolean) => void;
  setAutoCropEnabled: (enabled: boolean) => void;
  checkFileSystemIntegrity: () => Promise<void>;
  setHasHydrated: (val: boolean) => void;
  performPostHydrationCleanup: () => Promise<void>;
  // Batch actions
  addBatch: (batch: Batch) => void;
  deleteBatch: (batchId: string) => void;
  startRetake: (page: ScannedPage, phase: ScanPhase, studentIndex?: number) => void;
  clearRetake: () => void;
  setRetake: (retake: PendingRetake) => void;
  silentNextStudent: () => void;
  renameStudent: (studentIndex: number, newLabel: string) => void;
  deletePage: (studentIndex: number, pageIndex: number, phase?: string) => void;
  updatePagePathAndFilter: (pageId: string, phase: string | undefined, studentIndex: number | undefined, newFilePath: string, filterMode: string) => void;
  rotatePage: (pageId: string, phase: string | undefined, studentIndex: number | undefined, newFilePath: string, newOriginalFilePath?: string) => void;
  updateSessionId: (oldId: string, newId: string) => void;
  updateSessionDetails: (
    sessionId: string,
    name: string,
    batchId: string,
    batchName: string,
    subjectId?: string | null,
    totalMarks?: number | null,
    examDate?: string | null,
    settings?: ScanSessionSettings
  ) => void;
}

const createEmptySession = (): Partial<ScanSession> => ({
  question_paper: { page_count: 0, pages: [] },
  model_answer: { page_count: 0, pages: [] },
  students: [],
  stats: {
    total_students: 0,
    total_pages: 0,
    total_size_bytes: 0,
    blurry_pages: 0,
    scanning_duration_seconds: 0,
    avg_time_per_student_seconds: 0,
  },
});

export const recomputeStats = (session: ScanSession): ScanSession['stats'] => {
  const qpPages = session.question_paper?.pages?.length || 0;
  const maPages = session.model_answer?.pages?.length || 0;
  const studentsWithPages = (session.students || []).filter(s => (s.pages || []).length > 0);

  let totalPages = qpPages + maPages;
  let totalSizeBytes = 0;
  let blurryPages = 0;

  session.question_paper?.pages?.forEach(p => {
    totalSizeBytes += p.file_size || 0;
    if (p.is_blurry) blurryPages++;
  });
  session.model_answer?.pages?.forEach(p => {
    totalSizeBytes += p.file_size || 0;
    if (p.is_blurry) blurryPages++;
  });

  studentsWithPages.forEach(s => {
    totalPages += (s.pages || []).length;
    (s.pages || []).forEach(p => {
      totalSizeBytes += p.file_size || 0;
      if (p.is_blurry) blurryPages++;
    });
  });

  return {
    ...session.stats,
    total_students: studentsWithPages.length,
    total_pages: totalPages,
    total_size_bytes: totalSizeBytes,
    blurry_pages: blurryPages,
  };
};

const deleteLocalSessionFiles = async (session: ScanSession) => {
  const filePaths: string[] = [];
  if (session.question_paper?.pages) {
    session.question_paper.pages.forEach(p => {
      if (p.file_path) filePaths.push(p.file_path);
      if (p.original_file_path) filePaths.push(p.original_file_path);
      if (p.raw_file_path) filePaths.push(p.raw_file_path);
    });
  }
  if (session.model_answer?.pages) {
    session.model_answer.pages.forEach(p => {
      if (p.file_path) filePaths.push(p.file_path);
      if (p.original_file_path) filePaths.push(p.original_file_path);
      if (p.raw_file_path) filePaths.push(p.raw_file_path);
    });
  }
  if (session.students) {
    session.students.forEach(s => {
      s.pages?.forEach(p => {
        if (p.file_path) filePaths.push(p.file_path);
        if (p.original_file_path) filePaths.push(p.original_file_path);
        if (p.raw_file_path) filePaths.push(p.raw_file_path);
      });
    });
  }
  for (const path of filePaths) {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch (e) {
      console.warn(`Failed to delete local file: ${path}`, e);
    }
  }
};

const generateStudentLabel = (index: number, name?: string | null, roll?: string | null): string => {
  if (name && roll) return `${name} (${roll})`;
  if (name) return name;
  return `Student #${index}`;
};

export const useScanStore = create<ScanState>()(
  persist(
    (set, get) => ({
      currentSession: null,
      currentPhase: 'question_paper',
      currentStudentIndex: 0,
      savedSessions: [],
      deletedSessionIds: [],
      savedBatches: [],
      savedSubjects: [],
      isScanning: false,
      flashMode: 'auto',
      autoCaptureEnabled: true,
      autoCropEnabled: false,
      pendingRetake: null,
      hasHydrated: false,

      setHasHydrated: (val) => set({ hasHydrated: val }),

      createSession: async (
        name: string,
        batchId: string,
        batchName: string,
        settings: ScanSessionSettings,
        subjectId?: string,
        totalMarks?: number,
        examDate?: string
      ) => {
        const reusableDraft = findReusableDraftSession(get().savedSessions, {
          name,
          batchId,
          subjectId,
          totalMarks,
          examDate,
          settings,
        });

        if (reusableDraft) {
          set({
            currentSession: reusableDraft,
            currentPhase: reusableDraft.settings.scan_question_paper
              ? 'question_paper'
              : reusableDraft.settings.scan_model_answer
                ? 'model_answer'
                : 'students',
            currentStudentIndex: 0,
            isScanning: true,
            autoCaptureEnabled: reusableDraft.settings.auto_capture,
            autoCropEnabled: reusableDraft.settings.auto_crop === true,
          });

          return reusableDraft;
        }

        const finalSessionId = `local_${generateUUID()}`;

        const session: ScanSession = {
          session_id: finalSessionId,
          session_name: name,
          batch_id: batchId,
          batch_name: batchName,
          subject_id: subjectId || null,
          total_marks: totalMarks || null,
          exam_date: examDate || null,
          created_at: new Date().toISOString(),
          status: 'scanning',
          upload_progress: 0,
          settings,
          ...createEmptySession() as any,
        };

        // Initialize first student
        session.students = [{
          id: generateUUID(),
          student_index: 0,
          label: 'Student #1',
          page_count: 0,
          has_blurry_pages: false,
          pages: [],
        }];

        set({
          currentSession: session,
          savedSessions: [session, ...get().savedSessions],
          currentPhase: settings.scan_question_paper ? 'question_paper' :
            settings.scan_model_answer ? 'model_answer' : 'students',
          currentStudentIndex: 0,
          isScanning: true,
          autoCaptureEnabled: settings.auto_capture,
          autoCropEnabled: settings.auto_crop === true,
        });

        return session;
      },

      setCurrentPhase: (phase) => set({ currentPhase: phase }),

      clearRetake: () => set({ pendingRetake: null }),

      startRetake: (page, phase, studentIndex) => {
        const { currentSession, currentStudentIndex } = get();
        if (!currentSession) return;

        let pagesArray: ScannedPage[] = [];
        if (phase === 'question_paper') {
          pagesArray = currentSession.question_paper.pages || [];
        } else if (phase === 'model_answer') {
          pagesArray = currentSession.model_answer.pages || [];
        } else {
          const idx = studentIndex !== undefined ? studentIndex : currentStudentIndex;
          pagesArray = currentSession.students[idx]?.pages || [];
        }

        const replaceIndex = pagesArray.findIndex(p => p.page_number === page.page_number);
        if (replaceIndex > -1) {
          set({
            pendingRetake: {
              pageId: page.id,
              studentIndex: studentIndex !== undefined ? studentIndex : currentStudentIndex,
              phase,
              replaceIndex,
              originalPageNumber: page.page_number,
              originalFilePath: page.file_path,
            }
          });
        }
      },

      addPage: (page) => {
        const { currentSession, currentPhase, currentStudentIndex, savedSessions, pendingRetake } = get();
        if (!currentSession) return;

        // IDENTITY PROTECTION: Prevent duplicate page insertions by ID
        const isDuplicate = (pages: ScannedPage[]) => (pages || []).some(p => p.id === page.id);

        const updatedSession = { ...currentSession };

        // GUARD: ensure the current student slot exists
        if (currentPhase === 'students' && !updatedSession.students[currentStudentIndex]) {
          const students = [...updatedSession.students];
          while (students.length <= currentStudentIndex) {
            students.push({
              id: generateUUID(),
              student_index: students.length,
              label: `Student #${students.length + 1}`,
              pages: [],
              page_count: 0,
              has_blurry_pages: false,
            });
          }
          updatedSession.students = students;
        }

        if (pendingRetake) {
          // ==========================================
          // ATOMIC RECAPTURE REPLACEMENT FLOW
          // ==========================================
          page.id = pendingRetake.pageId;
          page.page_number = pendingRetake.originalPageNumber;
          
          if (pendingRetake.phase === 'question_paper') {
            const pages = [...updatedSession.question_paper.pages];
            page.ui_id = `${updatedSession.session_id}_qp_${page.file_path}`;
            pages[pendingRetake.replaceIndex] = page;
            updatedSession.question_paper.pages = pages;
          } else if (pendingRetake.phase === 'model_answer') {
            const pages = [...updatedSession.model_answer.pages];
            page.ui_id = `${updatedSession.session_id}_ma_${page.file_path}`;
            pages[pendingRetake.replaceIndex] = page;
            updatedSession.model_answer.pages = pages;
          } else {
            const studentIdx = pendingRetake.studentIndex ?? currentStudentIndex;
            const updatedStudents = [...(updatedSession.students || [])];
            const student = { ...updatedStudents[studentIdx] };
            const pages = [...(student.pages || [])];
            
            page.ui_id = `${updatedSession.session_id}_${student.student_index}_${page.file_path}`;
            pages[pendingRetake.replaceIndex] = page;
            
            student.pages = pages;
            if (page.is_blurry) student.has_blurry_pages = true;
            else student.has_blurry_pages = pages.some(p => p.is_blurry);
            
            updatedStudents[studentIdx] = student;
            updatedSession.students = updatedStudents;
          }

          // Trigger background file deletion for the old retaken image
          FileSystem.deleteAsync(pendingRetake.originalFilePath, { idempotent: true }).catch(e => {
            console.warn('[Recapture] Failed to delete original file:', e);
          });

          // Clear retake context since replacement is complete
          set({ pendingRetake: null });
        } else {
          // ==========================================
          // NORMAL APPEND FLOW
          // ==========================================
          if (currentPhase === 'question_paper') {
            if (!updatedSession.question_paper.pages) updatedSession.question_paper.pages = [];
            if (isDuplicate(updatedSession.question_paper.pages)) return;
            page.page_number = updatedSession.question_paper.pages.length + 1;
            page.ui_id = `${updatedSession.session_id}_qp_${page.file_path}`;
            updatedSession.question_paper.pages = [...updatedSession.question_paper.pages, page];
            updatedSession.question_paper.page_count = updatedSession.question_paper.pages.length;
          } else if (currentPhase === 'model_answer') {
            if (!updatedSession.model_answer.pages) updatedSession.model_answer.pages = [];
            if (isDuplicate(updatedSession.model_answer.pages)) return;
            page.page_number = updatedSession.model_answer.pages.length + 1;
            page.ui_id = `${updatedSession.session_id}_ma_${page.file_path}`;
            updatedSession.model_answer.pages = [...updatedSession.model_answer.pages, page];
            updatedSession.model_answer.page_count = updatedSession.model_answer.pages.length;
          } else {
            const updatedStudents = [...(updatedSession.students || [])];
            const student = { ...updatedStudents[currentStudentIndex] };
            if (student) {
              if (!student.pages) student.pages = [];
              if (isDuplicate(student.pages)) return;
              page.page_number = student.pages.length + 1;
              page.ui_id = `${updatedSession.session_id}_${student.student_index}_${page.file_path}`;
              student.pages = [...student.pages, page];
              student.page_count = student.pages.length;
              if (page.is_blurry) student.has_blurry_pages = true;
              updatedStudents[currentStudentIndex] = student;
              updatedSession.students = updatedStudents;
            }
          }
        }

        updatedSession.stats = recomputeStats(updatedSession);

        // BATCHED UPDATE: Update both current and saved list in ONE atomic set()
        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        } else {
          newSavedSessions.unshift(updatedSession);
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions
        });

        get().syncCurrentMetadata().catch(err =>
          console.error("[Persistence] Failed to sync new page:", err)
        );
      },

      removePage: (pageNumber: number, phaseOverride?: string, studentIndexOverride?: number) => {
        const { currentSession, currentPhase, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const phaseToUse = phaseOverride || currentPhase;
        let removed: ScannedPage | undefined;

        if (phaseToUse === 'question_paper') {
          const pageIndex = updatedSession.question_paper.pages.findIndex(p => p.page_number === pageNumber);
          if (pageIndex > -1) {
            const pages = [...updatedSession.question_paper.pages];
            [removed] = pages.splice(pageIndex, 1);
            updatedSession.question_paper.pages = pages;
            updatedSession.question_paper.page_count--;
          }
        } else if (phaseToUse === 'model_answer') {
          const pageIndex = updatedSession.model_answer.pages.findIndex(p => p.page_number === pageNumber);
          if (pageIndex > -1) {
            const pages = [...updatedSession.model_answer.pages];
            [removed] = pages.splice(pageIndex, 1);
            updatedSession.model_answer.pages = pages;
            updatedSession.model_answer.page_count--;
          }
        } else {
          const studentIdx = studentIndexOverride !== undefined ? studentIndexOverride : currentStudentIndex;
          const updatedStudents = [...updatedSession.students];
          const student = { ...updatedStudents[studentIdx] };
          if (student) {
            const pageIndex = student.pages.findIndex(p => p.page_number === pageNumber);
            if (pageIndex > -1) {
              const pages = [...student.pages];
              [removed] = pages.splice(pageIndex, 1);
              student.pages = pages;
              student.page_count--;
              if (removed.is_blurry) {
                student.has_blurry_pages = student.pages.some(p => p.is_blurry);
              }
              updatedStudents[studentIdx] = student;
              updatedSession.students = updatedStudents;
            }
          }
        }

        if (removed) {
          updatedSession.stats = recomputeStats(updatedSession);
        }

        // BATCHED UPDATE: Update both current and saved list in ONE atomic set()
        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions
        });

        // Realtime Persistence: Sync removal
        get().syncCurrentMetadata().catch(err =>
          console.error("[Persistence] Failed to sync page removal:", err)
        );
      },

      nextStudent: (metadata?: { name?: string; roll_number?: string }) => {
        const { currentSession, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const nextIndex = currentStudentIndex + 1;

        // Finalize label for current student if they were just created and had no metadata
        // Actually, it's better to set metadata on the *new* student.

        // Ensure student exists and has an ID
        if (nextIndex >= updatedSession.students.length) {
          const name = metadata?.name || null;
          const roll = metadata?.roll_number || null;

          updatedSession.students = [
            ...updatedSession.students,
            {
              id: generateUUID(),
              student_index: nextIndex + 1,
              name: name,
              roll_number: roll,
              label: generateStudentLabel(nextIndex + 1, name, roll),
              page_count: 0,
              has_blurry_pages: false,
              pages: [],
            },
          ];
        } else if (metadata) {
          // If we somehow jump to an existing empty student, update metadata
          const student = { ...updatedSession.students[nextIndex] };
          student.name = metadata.name || student.name;
          student.roll_number = metadata.roll_number || student.roll_number;
          student.label = generateStudentLabel(student.student_index, student.name, student.roll_number);
          updatedSession.students[nextIndex] = student;
        }

        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        updatedSession.stats = recomputeStats(updatedSession);

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions,
          currentStudentIndex: nextIndex,
          currentPhase: 'students',
        });

        get().syncCurrentMetadata('student', nextIndex).catch(err =>
          console.error("[Persistence] Failed to sync next student:", err)
        );
      },

      updateStudentMetadata: (studentIndex: number, name: string, rollNumber: string) => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const student = { ...updatedSession.students[studentIndex] };
        if (student) {
          student.name = name || null;
          student.roll_number = rollNumber || null;
          student.label = generateStudentLabel(student.student_index, student.name, student.roll_number);
          updatedSession.students[studentIndex] = student;

          const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
          const newSavedSessions = [...savedSessions];
          if (existingIndex > -1) {
            newSavedSessions[existingIndex] = updatedSession;
          }

          set({
            currentSession: updatedSession,
            savedSessions: newSavedSessions
          });

          get().syncCurrentMetadata('student', studentIndex).catch(err =>
            console.error("[Persistence] Failed to sync student metadata:", err)
          );
        }
      },

      previousStudent: () => {
        const { currentStudentIndex } = get();
        if (currentStudentIndex > 0) {
          set({ currentStudentIndex: currentStudentIndex - 1 });
        }
      },

      updateStudentBarcode: (studentIndex: number, barcodeData: { type: string; data: string; matched_name?: string }) => {
        const { currentSession } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const student = updatedSession.students[studentIndex];
        if (student) {
          student.barcode_data = barcodeData;
          if (barcodeData.matched_name) {
            student.label = barcodeData.matched_name;
          } else if (barcodeData.data) {
            student.label = `Roll #${barcodeData.data}`;
          }
        }

        set({ currentSession: updatedSession });
      },

      finishSession: () => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession, status: 'ready' as const };

        // Filter out empty students
        updatedSession.students = updatedSession.students.filter(s => s.page_count > 0);
        updatedSession.stats.total_students = updatedSession.students.length;

        // Update saved sessions
        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];

        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        } else {
          newSavedSessions.unshift(updatedSession);
        }

        set({
          currentSession: null,
          savedSessions: newSavedSessions,
          isScanning: false,
          currentStudentIndex: 0,
          currentPhase: 'question_paper',
        });
      },

      saveSession: () => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        // Cleanup empty students on save
        updatedSession.students = updatedSession.students.filter(s => s.page_count > 0);
        updatedSession.stats = recomputeStats(updatedSession);

        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];

        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        } else {
          newSavedSessions.unshift(updatedSession);
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions
        });
      },

      deleteSession: async (sessionId: string) => {
        const { savedSessions, currentSession, deletedSessionIds } = get();
        const sessionToDelete = savedSessions.find(s => s.session_id === sessionId);

        const updatedDeletedIds = [...new Set([...(deletedSessionIds || []), sessionId])];

        set({
          savedSessions: (savedSessions || []).filter(s => s.session_id !== sessionId),
          currentSession: currentSession?.session_id === sessionId ? null : currentSession,
          deletedSessionIds: updatedDeletedIds,
        });

        if (sessionToDelete) {
          // Clean up local files asynchronously
          deleteLocalSessionFiles(sessionToDelete).catch(e => {
            console.warn('Failed to clean up session files:', e);
          });

          // Call backend if it's not a local offline session
          if (!sessionId.startsWith('local_')) {
            try {
              const { useAuthStore } = await import('./authStore');
              const token = useAuthStore.getState().sessionToken;
              const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

              if (backendUrl && token) {
                await fetch(`${backendUrl}/api/scan-sessions/${sessionId}`, {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                  }
                });
              }
            } catch (error) {
              console.warn('Network error while deleting session on backend:', error);
            }
          }
        }
      },

      updateSessionId: (oldId: string, newId: string) => {
        const { savedSessions, currentSession } = get();
        
        const updateSessionObj = (s: ScanSession): ScanSession => ({
          ...s,
          session_id: newId,
        });

        const newSavedSessions = savedSessions.map(s => 
          s.session_id === oldId ? updateSessionObj(s) : s
        );

        set({
          savedSessions: newSavedSessions,
          currentSession: currentSession?.session_id === oldId
            ? updateSessionObj(currentSession)
            : currentSession,
        });
      },

      updateSessionDetails: (
        sessionId: string,
        name: string,
        batchId: string,
        batchName: string,
        subjectId = null,
        totalMarks = null,
        examDate = null,
        settings
      ) => {
        const { savedSessions, currentSession } = get();
        
        const updateSessionObj = (s: ScanSession): ScanSession => ({
          ...s,
          session_name: name,
          batch_id: batchId,
          batch_name: batchName,
          subject_id: subjectId,
          total_marks: totalMarks,
          exam_date: examDate,
          settings: settings || s.settings,
        });

        const newSavedSessions = savedSessions.map(s => 
          s.session_id === sessionId ? updateSessionObj(s) : s
        );

        set({
          savedSessions: newSavedSessions,
          currentSession: currentSession?.session_id === sessionId
            ? updateSessionObj(currentSession)
            : currentSession,
        });
      },

      replaceSessionDocuments: (sessionId, documents) => {
        const { savedSessions, currentSession } = get();

        const normalizedPages = (pages: ScannedPage[] | undefined) =>
          (pages || []).map((page, index) => ({
            ...page,
            page_number: index + 1,
          }));

        const updateSessionObj = (session: ScanSession): ScanSession => {
          const updated: ScanSession = {
            ...session,
            question_paper: {
              ...session.question_paper,
              pages: normalizedPages(documents.questionPaper ?? session.question_paper.pages),
            },
            model_answer: {
              ...session.model_answer,
              pages: normalizedPages(documents.modelAnswer ?? session.model_answer.pages),
            },
          };

          updated.question_paper.page_count = updated.question_paper.pages.length;
          updated.model_answer.page_count = updated.model_answer.pages.length;

          if (documents.studentPapers) {
            updated.students = documents.studentPapers.map((page, index) => {
              const normalizedPage = {
                ...page,
                page_number: 1,
                ui_id: `${session.session_id}_student_${index}_${page.file_path}`,
              };
              return {
                id: generateUUID(),
                student_index: index,
                label: page.original_name?.replace(/\.[^.]+$/, '') || `Student #${index + 1}`,
                page_count: 1,
                has_blurry_pages: false,
                pages: [normalizedPage],
              };
            });
          }

          updated.question_paper.pages = updated.question_paper.pages.map(page => ({
            ...page,
            ui_id: `${session.session_id}_qp_${page.file_path}`,
          }));
          updated.model_answer.pages = updated.model_answer.pages.map(page => ({
            ...page,
            ui_id: `${session.session_id}_ma_${page.file_path}`,
          }));
          updated.stats = recomputeStats(updated);
          return updated;
        };

        let updatedCurrentSession: ScanSession | null = null;
        const newSavedSessions = savedSessions.map(session => {
          if (session.session_id !== sessionId) return session;
          const updated = updateSessionObj(session);
          updatedCurrentSession = updated;
          return updated;
        });

        if (!updatedCurrentSession && currentSession?.session_id === sessionId) {
          updatedCurrentSession = updateSessionObj(currentSession);
        }

        set({
          savedSessions: newSavedSessions,
          currentSession: currentSession?.session_id === sessionId
            ? updatedCurrentSession
            : currentSession,
        });
      },

      loadSession: (sessionId: string) => {
        const { savedSessions } = get();
        const session = savedSessions.find(s => s.session_id === sessionId);
        if (session) {
          set({ currentSession: session });
        }
      },

      prepareSessionForScanning: (sessionId: string, phase: ScanPhase) => {
        const { savedSessions, currentSession } = get();
        const baseSession = savedSessions.find(s => s.session_id === sessionId)
          || (currentSession?.session_id === sessionId ? currentSession : null);

        if (!baseSession) return;

        const prepared = prepareSessionForScanningPhase(baseSession, phase, generateUUID);
        const newSavedSessions = savedSessions.some(s => s.session_id === sessionId)
          ? savedSessions.map(s => s.session_id === sessionId ? prepared.session : s)
          : [prepared.session, ...savedSessions];

        set({
          currentSession: prepared.session,
          currentPhase: phase,
          currentStudentIndex: prepared.studentIndex,
          isScanning: true,
          savedSessions: newSavedSessions,
        });
      },

      updateSessionStatus: (sessionId, status, progress = 0, examId) => {
        const { savedSessions, currentSession } = get();

        const newSavedSessions = savedSessions.map(s => {
          if (s.session_id === sessionId) {
            const updated: any = { ...s, status, upload_progress: progress };
            if (examId) updated.exam_id = examId;
            return updated;
          }
          return s;
        });

        set({
          savedSessions: newSavedSessions,
          currentSession: currentSession?.session_id === sessionId
            ? { 
                ...currentSession, 
                status, 
                upload_progress: progress, 
                exam_id: examId || currentSession.exam_id 
              }
            : currentSession,
        });
      },

      setFlashMode: (mode) => set({ flashMode: mode }),
      setAutoCaptureEnabled: (enabled) => set({ autoCaptureEnabled: enabled }),
      setAutoCropEnabled: (enabled) => set({ autoCropEnabled: enabled }),

      clearCurrentSession: () => set({
        currentSession: null,
        isScanning: false,
        currentStudentIndex: 0,
        currentPhase: 'question_paper',
      }),

      undoLastPage: () => {
        const { currentSession, currentPhase, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        let lastPage: ScannedPage | undefined;

        if (currentPhase === 'question_paper' && updatedSession.question_paper.pages.length > 0) {
          const pages = [...updatedSession.question_paper.pages];
          lastPage = pages.pop();
          updatedSession.question_paper.pages = pages;
          if (lastPage) updatedSession.question_paper.page_count--;
        } else if (currentPhase === 'model_answer' && updatedSession.model_answer.pages.length > 0) {
          const pages = [...updatedSession.model_answer.pages];
          lastPage = pages.pop();
          updatedSession.model_answer.pages = pages;
          if (lastPage) updatedSession.model_answer.page_count--;
        } else {
          const updatedStudents = [...updatedSession.students];
          const student = { ...updatedStudents[currentStudentIndex] };
          if (student && student.pages.length > 0) {
            const pages = [...student.pages];
            lastPage = pages.pop();
            student.pages = pages;
            if (lastPage) {
              student.page_count--;
              student.has_blurry_pages = student.pages.some(p => p.is_blurry);
            }
            updatedStudents[currentStudentIndex] = student;
            updatedSession.students = updatedStudents;
          }
        }

        if (lastPage) {
          updatedSession.stats = recomputeStats(updatedSession);
        }

        // BATCHED UPDATE: Update both current and saved list in ONE atomic set()
        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions
        });

        // Realtime Persistence: Sync undo
        get().syncCurrentMetadata().catch(err =>
          console.error("[Persistence] Failed to sync undo:", err)
        );
      },

      // Batch actions
      addBatch: (batch) => {
        const { savedBatches } = get();
        set({ savedBatches: [...savedBatches, batch] });
      },

      deleteBatch: (batchId) => {
        const { savedBatches } = get();
        set({ savedBatches: savedBatches.filter(b => b.batch_id !== batchId) });
      },

      fetchSessions: async () => {
        const start = Date.now();
        console.log(`[TRACE] fetchSessions: start at ${start}`);
        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;
          const backendUrl = getBackendUrl();

          const response = await fetchWithTimeout(`${backendUrl}/api/scan-sessions`, {
            headers: {
              'Authorization': token ? `Bearer ${token}` : '',
            }
          }, 2500);

          if (!response.ok) {
            throw new Error(`Failed to fetch sessions: ${response.status}`);
          }

          const data = await response.json();
          const fetchedSessions = data.sessions || [];

          // NORMALIZATION: Ensure all fetched sessions have accurate derived stats and ui_ids
          const normalizedSessions = fetchedSessions.map((s: ScanSession) => {
            // Apply ui_ids to all pages
            if (s.question_paper?.pages) {
              s.question_paper.pages.forEach(p => {
                p.ui_id = `${s.session_id}_qp_${p.file_path}`;
              });
            }
            if (s.model_answer?.pages) {
              s.model_answer.pages.forEach(p => {
                p.ui_id = `${s.session_id}_ma_${p.file_path}`;
              });
            }
            if (s.students) {
              s.students.forEach(st => {
                st.pages?.forEach(p => {
                  p.ui_id = `${s.session_id}_${st.student_index}_${p.file_path}`;
                });
              });
            }
            return {
              ...s,
              stats: recomputeStats(s)
            };
          });

          console.log(`[TRACE] fetchSessions: success, received ${normalizedSessions.length} sessions at ${Date.now()}`);
          // Merge remote scanner state with local-only drafts while keeping the server
          // authoritative for already-synced cloud sessions.
          set(state => {
            return reconcileFetchedScanSessions({
              currentSaved: state.savedSessions || [],
              fetchedSessions: normalizedSessions,
              deletedSessionIds: state.deletedSessionIds || [],
              recomputeStats,
            });
          });
        } catch (error) {
          console.error(`[TRACE] fetchSessions: FAILED at ${Date.now()} with error:`, error);
        }
      },

      fetchBatches: async () => {
        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;
          const backendUrl = getBackendUrl();

          const response = await fetchWithTimeout(`${backendUrl}/api/batches`, {
            headers: {
              'Authorization': token ? `Bearer ${token}` : '',
              'Bypass-Tunnel-Reminder': 'true',
            }
          }, 2500);

          if (!response.ok) {
            throw new Error(`Failed to fetch batches: ${response.status}`);
          }

          const data = await response.json();
          const batches = data.batches || [];
          set({ savedBatches: batches });
        } catch (error) {
          console.error("Error fetching batches:", error);
        }
      },

      fetchSubjects: async () => {
        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;
          const backendUrl = getBackendUrl();

          const response = await fetchWithTimeout(`${backendUrl}/api/subjects`, {
            headers: {
              'Authorization': token ? `Bearer ${token}` : '',
              'Bypass-Tunnel-Reminder': 'true',
            }
          }, 2500);

          if (!response.ok) {
            throw new Error(`Failed to fetch subjects: ${response.status}`);
          }

          const data = await response.json();
          const subjects = data.subjects || [];
          set({ savedSubjects: subjects });
        } catch (error) {
          console.error("Error fetching subjects:", error);
        }
      },

      createBatch: async (name: string, studentCount?: number) => {
        const cleanName = name.trim();
        if (!cleanName) {
          throw new Error('Batch name is required');
        }

        const { useAuthStore } = await import('./authStore');
        const token = useAuthStore.getState().sessionToken;
        const backendUrl = getBackendUrl();

        const response = await fetchWithTimeout(`${backendUrl}/api/batches`, {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'Bypass-Tunnel-Reminder': 'true',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: cleanName }),
        }, 6000);

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail || `Failed to create batch: ${response.status}`);
        }

        const data = await response.json();
        const rawBatch = data.batch || data.data || data;
        const batchId = rawBatch.batch_id || rawBatch.id;
        if (!batchId) {
          throw new Error('Batch creation response did not include an id');
        }

        const normalizedBatch: Batch = {
          batch_id: batchId,
          name: rawBatch.name || cleanName,
          student_count: Number(rawBatch.student_count ?? rawBatch.studentCount ?? studentCount ?? 0),
        };

        set(state => ({
          savedBatches: [
            normalizedBatch,
            ...state.savedBatches.filter(item => item.batch_id !== normalizedBatch.batch_id),
          ],
        }));

        return normalizedBatch;
      },

      createSubject: async (name: string, classStandard?: string) => {
        const cleanName = name.trim();
        if (!cleanName) {
          throw new Error('Subject name is required');
        }

        const { useAuthStore } = await import('./authStore');
        const token = useAuthStore.getState().sessionToken;
        const backendUrl = getBackendUrl();

        const response = await fetchWithTimeout(`${backendUrl}/api/subjects`, {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'Bypass-Tunnel-Reminder': 'true',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: cleanName,
            classStandard: classStandard?.trim() || null,
          }),
        }, 6000);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Failed to create subject: ${response.status}`);
        }

        const data = await response.json();
        const subject = data.subject || data.data;
        const normalizedSubject: Subject = {
          id: subject.id,
          name: subject.name,
          classStandard: subject.classStandard || subject.class_standard,
        };
        set(state => ({
          savedSubjects: [
            normalizedSubject,
            ...state.savedSubjects.filter(item => item.id !== normalizedSubject.id),
          ],
        }));
        return normalizedSubject;
      },

      syncCurrentMetadata: async (phaseOverride?: 'question_paper' | 'model_answer' | 'student', studentIndexOverride?: number) => {
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;
        if (currentSession.session_id.startsWith('local_')) {
          console.log("[Sync] Skipping sync for local offline session");
          return;
        }

        const phaseToUse = phaseOverride || currentPhase;
        const studentIndexToUse = studentIndexOverride !== undefined ? studentIndexOverride : currentStudentIndex;

        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;
          const backendUrl = getBackendUrl();

          if (!backendUrl) throw new Error("Missing Backend URL configuration");

          const authHeaders = {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
          };

          let endpoint = '';
          let body = {};

          if (phaseToUse === 'question_paper') {
            endpoint = `${backendUrl}/api/scan-sessions/${currentSession.session_id}/upload-qp`;
            body = { pages: currentSession.question_paper.pages };
          } else if (phaseToUse === 'model_answer') {
            endpoint = `${backendUrl}/api/scan-sessions/${currentSession.session_id}/upload-model`;
            body = { pages: currentSession.model_answer.pages };
          } else {
            const student = currentSession.students[studentIndexToUse];
            if (!student) return;
            endpoint = `${backendUrl}/api/scan-sessions/${currentSession.session_id}/upload-student`;
            body = { student: student };
          }

          console.log(`[TRACE] syncCurrentMetadata: start for ${currentPhase} at ${Date.now()}...`);

          const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(body)
          }, 3500);

          if (!response.ok) {
            throw new Error(`Sync failed with status ${response.status}`);
          }

          console.log(`[TRACE] syncCurrentMetadata: SUCCESS for ${currentPhase} at ${Date.now()}`);
        } catch (error) {
          console.error(`[TRACE] syncCurrentMetadata: FAILED for ${currentPhase} at ${Date.now()} with error:`, error);
        }
      },

      checkFileSystemIntegrity: async () => {
        const session = get().currentSession;
        if (!session) return;

        console.log(`[TRACE] checkFileSystemIntegrity: START for session ${session.session_id} at ${Date.now()}`);
        const qpPages = session.question_paper.pages;
        const maPages = session.model_answer.pages;
        const studentPages = session.students.flatMap(s => s.pages);

        const allPages = [...qpPages, ...maPages, ...studentPages];
        let missingCount = 0;

        for (const page of allPages) {
          const file = new FileSystem.File(page.file_path);
          if (!file.exists) {
            console.warn(`[TRACE] checkFileSystemIntegrity: Missing file ${page.file_path}`);
            missingCount++;
          }
        }

        if (missingCount > 0) {
          console.error(`[TRACE] checkFileSystemIntegrity: FINISHED at ${Date.now()} with ${missingCount} missing files.`);
        } else {
          console.log(`[TRACE] checkFileSystemIntegrity: SUCCESS at ${Date.now()}, all ${allPages.length} files verified.`);
        }
      },

      performPostHydrationCleanup: async () => {
        const state = get();
        console.log(`[TRACE] performPostHydrationCleanup: START at ${Date.now()}`);

        // 1. Hardening: Reset interrupted uploads (moved from hydration callback)
        if (state.currentSession?.status === 'uploading') {
          console.log('[Persistence] Resetting stuck "uploading" session status');
          state.updateSessionStatus(state.currentSession.session_id, 'scanning', 0);
        }

        // 2. Scheduled Integrity Check
        await state.checkFileSystemIntegrity();

        console.log(`[TRACE] performPostHydrationCleanup: FINISHED at ${Date.now()}`);
      },

      setRetake: (retake: PendingRetake) => {
        // Called from review screen when teacher taps "Recapture" on a page.
        // Scanner reads pendingRetake on next addPage and replaces instead of appending.
        set({ pendingRetake: retake });
      },

      silentNextStudent: () => {
        // No modal. Auto-advance. Teacher names students later in review.
        const { currentSession, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        const nextIdx = currentStudentIndex + 1;
        const updatedSession = { ...currentSession };
        const students = [...updatedSession.students];

        // Ensure current slot exists before advancing
        if (students.length === 0) {
          students.push({
            id: generateUUID(),
            student_index: 0,
            label: 'Student #1',
            pages: [],
            page_count: 0,
            has_blurry_pages: false,
          });
        }

        // Add next student slot
        if (nextIdx >= students.length) {
          students.push({
            id: generateUUID(),
            student_index: nextIdx,
            label: `Student #${nextIdx + 1}`,
            pages: [],
            page_count: 0,
            has_blurry_pages: false,
          });
        }

        updatedSession.students = students;
        updatedSession.stats = recomputeStats(updatedSession);

        const newSavedSessions = [...savedSessions];
        const existingIndex = newSavedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          currentStudentIndex: nextIdx,
          currentPhase: 'students',
          savedSessions: newSavedSessions,
        });
      },

      // ── Rename studentLabel inline from review ────────────────────────────────
      renameStudent: (studentIndex: number, newLabel: string) => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;
        const updatedSession = { ...currentSession };
        const student = { ...updatedSession.students[studentIndex] };
        student.label = newLabel.trim() || student.label;
        updatedSession.students[studentIndex] = student;
        
        const newSavedSessions = [...savedSessions];
        const existingIndex = newSavedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions,
        });

        get().syncCurrentMetadata('student', studentIndex).catch(err =>
          console.error("[Persistence] Failed to sync student rename:", err)
        );
      },

      // ── Delete a single page (for review screen "remove" action) ─────────────
      deletePage: (studentIndex: number, pageIndex: number, phase?: string) => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;
        const updatedSession = { ...currentSession };

        if (phase === 'students') {
          const student = { ...updatedSession.students[studentIndex] };
          const pages = [...student.pages];
          pages.splice(pageIndex, 1);
          // Re-number
          student.pages = pages.map((p, i) => ({ ...p, page_number: i + 1 }));
          student.page_count = student.pages.length;
          updatedSession.students[studentIndex] = student;
        } else if (phase === 'question_paper') {
          const pages = [...updatedSession.question_paper.pages];
          pages.splice(pageIndex, 1);
          updatedSession.question_paper.pages = pages.map((p, i) => ({ ...p, page_number: i + 1 }));
          updatedSession.question_paper.page_count = updatedSession.question_paper.pages.length;
        } else if (phase === 'model_answer') {
          const pages = [...updatedSession.model_answer.pages];
          pages.splice(pageIndex, 1);
          updatedSession.model_answer.pages = pages.map((p, i) => ({ ...p, page_number: i + 1 }));
          updatedSession.model_answer.page_count = updatedSession.model_answer.pages.length;
        }

        updatedSession.stats = recomputeStats(updatedSession);
        
        const newSavedSessions = [...savedSessions];
        const existingIndex = newSavedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions,
        });

        if (phase === 'question_paper' || phase === 'model_answer') {
          get().syncCurrentMetadata(phase).catch(err =>
            console.error("[Persistence] Failed to sync page delete:", err)
          );
        } else if (phase === 'students') {
          get().syncCurrentMetadata('student', studentIndex).catch(err =>
            console.error("[Persistence] Failed to sync student page delete:", err)
          );
        }
      },

      updatePagePathAndFilter: (pageId, phase, studentIndex, newFilePath, filterMode) => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;
        const updatedSession = { ...currentSession };

        const updatePageInArray = (pages: ScannedPage[]) => {
          const idx = pages.findIndex(p => p.id === pageId);
          if (idx > -1) {
            pages[idx] = { ...pages[idx], file_path: newFilePath, filter_mode: filterMode as any };
          }
        };

        if (phase === 'question_paper') {
          const pages = [...updatedSession.question_paper.pages];
          updatePageInArray(pages);
          updatedSession.question_paper.pages = pages;
        } else if (phase === 'model_answer') {
          const pages = [...updatedSession.model_answer.pages];
          updatePageInArray(pages);
          updatedSession.model_answer.pages = pages;
        } else {
          const idx = studentIndex ?? get().currentStudentIndex;
          const student = { ...updatedSession.students[idx] };
          const pages = [...student.pages];
          updatePageInArray(pages);
          student.pages = pages;
          updatedSession.students[idx] = student;
        }

        const newSavedSessions = [...savedSessions];
        const existingIndex = newSavedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions,
        });

        if (phase === 'question_paper' || phase === 'model_answer') {
          get().syncCurrentMetadata(phase).catch(err =>
            console.error("[Persistence] Failed to sync page filter update:", err)
          );
        } else {
          get().syncCurrentMetadata('student', studentIndex ?? get().currentStudentIndex).catch(err =>
            console.error("[Persistence] Failed to sync student page filter update:", err)
          );
        }
      },

      rotatePage: (pageId, phase, studentIndex, newFilePath, newOriginalFilePath) => {
        const { currentSession, savedSessions } = get();
        if (!currentSession) return;
        const updatedSession = { ...currentSession };

        const updatePageInArray = (pages: ScannedPage[]) => {
          const idx = pages.findIndex(p => p.id === pageId);
          if (idx > -1) {
            pages[idx] = { 
              ...pages[idx], 
              file_path: newFilePath, 
              ...(newOriginalFilePath ? { original_file_path: newOriginalFilePath } : {}),
              orientation_degrees: (((pages[idx].orientation_degrees || 0) + 90) % 360) as 0 | 90 | 180 | 270,
              needs_orientation_review: false,
            };
          }
        };

        if (phase === 'question_paper') {
          const pages = [...updatedSession.question_paper.pages];
          updatePageInArray(pages);
          updatedSession.question_paper.pages = pages;
        } else if (phase === 'model_answer') {
          const pages = [...updatedSession.model_answer.pages];
          updatePageInArray(pages);
          updatedSession.model_answer.pages = pages;
        } else {
          const idx = studentIndex ?? get().currentStudentIndex;
          const student = { ...updatedSession.students[idx] };
          const pages = [...student.pages];
          updatePageInArray(pages);
          student.pages = pages;
          updatedSession.students[idx] = student;
        }

        const newSavedSessions = [...savedSessions];
        const existingIndex = newSavedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

        set({
          currentSession: updatedSession,
          savedSessions: newSavedSessions,
        });

        if (phase === 'question_paper' || phase === 'model_answer') {
          get().syncCurrentMetadata(phase).catch(err =>
            console.error("[Persistence] Failed to sync page rotation:", err)
          );
        } else {
          get().syncCurrentMetadata('student', studentIndex ?? get().currentStudentIndex).catch(err =>
            console.error("[Persistence] Failed to sync student page rotation:", err)
          );
        }
      },
    }),
    {
      name: 'scan-storage',
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          console.log(`[TRACE] scan-storage.getItem: start for ${name} at ${Date.now()}`);
          return AsyncStorage.getItem(name);
        },
        setItem: (name, value) => {
          console.log(`[TRACE] scan-storage.setItem: REQUESTED for ${name} (size: ${value.length}) at ${Date.now()}`);
          // PHASE M1: Debounce heavy persistence writes to stop SQLITE_FULL crashes
          return new Promise<void>((resolve) => {
            const timeoutId = (global as any)[`debounce_${name}`];
            if (timeoutId) clearTimeout(timeoutId);

            // TASK 3D: Flush critical status writes immediately
            const isCriticalWrite = value.includes('"status":"uploaded"') || value.includes('"status":"completed"');
            const debounceMs = isCriticalWrite ? 0 : 1000;

            (global as any)[`debounce_${name}`] = setTimeout(async () => {
              try {
                const writeStart = Date.now();
                console.log(`[TRACE] scan-storage.setItem: WRITING to disk for ${name} at ${writeStart}`);
                await AsyncStorage.setItem(name, value);
                console.log(`[TRACE] scan-storage.setItem: SUCCESS for ${name} at ${Date.now()} (duration: ${Date.now() - writeStart}ms)`);
                resolve();
              } catch (e) {
                console.error(`[TRACE] scan-storage.setItem: FAILED for ${name} at ${Date.now()}:`, e);
                resolve();
              }
            }, debounceMs); // 1s debounce for regular metadata, 0 for critical
          });
        },
        removeItem: (name) => {
          console.log(`[TRACE] scan-storage.removeItem: ${name} at ${Date.now()}`);
          return AsyncStorage.removeItem(name);
        },
      })),
      partialize: (state) => {
        // HYDRATION ISOLATION: Do not persist hydration, transient UI flags, or retake context
        const { hasHydrated, isScanning, pendingRetake, autoCropEnabled, ...persistentState } = state;

        // Deeply strip base64 from sessions before persisting
        const cleanupSession = (session: any) => {
          if (!session) return null;
          const clean = { ...session };

          if (clean.question_paper?.pages) {
            clean.question_paper.pages = clean.question_paper.pages.map(({ base64, ...p }: any) => p);
          }
          if (clean.model_answer?.pages) {
            clean.model_answer.pages = clean.model_answer.pages.map(({ base64, ...p }: any) => p);
          }
          if (clean.students) {
            clean.students = clean.students.map((s: any) => ({
              ...s,
              pages: s.pages?.map(({ base64, ...p }: any) => p) || []
            }));
          }
          return clean;
        };

        return {
          ...persistentState,
          currentSession: cleanupSession(persistentState.currentSession),
          // PHASE M1: Limit persistence history to 10 most recent sessions
          savedSessions: (persistentState.savedSessions || []).slice(0, 10).map(cleanupSession),
        };
      },
      onRehydrateStorage: () => (state) => {
        console.log(`[TRACE] scan-storage.onRehydrateStorage: Hydration complete at ${Date.now()}`);
        if (state) {
          // 1. Aggressive cleanup of legacy base64 data to fix SQLITE_FULL
          // This happens in memory, and because hasHydrated is excluded from partialize,
          // setting it to true will NOT trigger a persistence write.
          const cleanupSession = (session: any) => {
            if (!session) return;

            // BACKWARD COMPATIBILITY: Assign IDs if missing
            if (session.question_paper?.pages) {
              session.question_paper.pages.forEach((p: any) => {
                delete p.base64;
                if (!p.id) p.id = generateUUID();
                p.ui_id = `${session.session_id}_qp_${p.file_path}`;
              });
            }
            if (session.model_answer?.pages) {
              session.model_answer.pages.forEach((p: any) => {
                delete p.base64;
                if (!p.id) p.id = generateUUID();
                p.ui_id = `${session.session_id}_ma_${p.file_path}`;
              });
            }
            if (session.students) {
              session.students.forEach((s: any) => {
                if (!s.id) s.id = generateUUID();
                if (s.pages) {
                  s.pages.forEach((p: any) => {
                    delete p.base64;
                    if (!p.id) p.id = generateUUID();
                    p.ui_id = `${session.session_id}_${s.student_index}_${p.file_path}`;
                  });
                }
              });
            }

            // DERIVED-STATE NORMALIZATION: Recompute aggregate stats from nested data
            session.settings = {
              ...(session.settings || {}),
              auto_crop: false,
            };
            session.stats = recomputeStats(session);
          };

          state.savedSessions?.forEach(cleanupSession);
          cleanupSession(state.currentSession);
          state.autoCropEnabled = false;

          // HYDRATION ISOLATION: Mark hydration complete without triggering setItem
          state.setHasHydrated(true);
        }
      },
    }
  )
);
