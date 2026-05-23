import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScanSession, ScanPhase, ScannedPage, ScanSessionSettings, ScannedStudent, Batch } from '../types';
import * as FileSystem from 'expo-file-system';

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

  // Saved batches
  savedBatches: Batch[];

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
  deleteSession: (sessionId: string) => void;
  loadSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: ScanSession['status'], progress: number) => void;
  fetchSessions: () => Promise<void>;
  createSession: (name: string, batchId: string, batchName: string, settings: ScanSessionSettings) => Promise<void>;
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
      savedBatches: [],
      isScanning: false,
      flashMode: 'auto',
      autoCaptureEnabled: true,
      autoCropEnabled: true,
      pendingRetake: null,
      hasHydrated: false,

      setHasHydrated: (val) => set({ hasHydrated: val }),

      createSession: async (name: string, batchId: string, batchName: string, settings: ScanSessionSettings) => {
        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;

          // Call backend to create real session
          const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/scan-sessions/create`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify({
              session_name: name,
              batch_id: batchId,
              settings: settings
            })
          });

          if (!response.ok) {
            throw new Error(`Failed to create session on backend: ${response.status}`);
          }

          const data = await response.json();
          const backendSessionId = data.session_id;

          const session: ScanSession = {
            session_id: backendSessionId,
            session_name: name,
            batch_id: batchId,
            batch_name: batchName,
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
            autoCropEnabled: true,
          });
        } catch (error) {
          console.error("Error creating session:", error);
          throw error;
        }
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

      deleteSession: (sessionId: string) => {
        const { savedSessions } = get();
        set({
          savedSessions: savedSessions.filter(s => s.session_id !== sessionId)
        });
      },

      loadSession: (sessionId: string) => {
        const { savedSessions } = get();
        const session = savedSessions.find(s => s.session_id === sessionId);
        if (session) {
          set({ currentSession: session });
        }
      },

      updateSessionStatus: (sessionId, status, progress = 0) => {
        const { savedSessions, currentSession } = get();

        const newSavedSessions = savedSessions.map(s =>
          s.session_id === sessionId ? { ...s, status, upload_progress: progress } : s
        );

        set({
          savedSessions: newSavedSessions,
          currentSession: currentSession?.session_id === sessionId
            ? { ...currentSession, status, upload_progress: progress }
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
          const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

          const response = await fetch(`${backendUrl}/api/scan-sessions`, {
            headers: {
              'Authorization': token ? `Bearer ${token}` : '',
            }
          });

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
          set({ savedSessions: normalizedSessions });
        } catch (error) {
          console.error(`[TRACE] fetchSessions: FAILED at ${Date.now()} with error:`, error);
        }
      },

      syncCurrentMetadata: async (phaseOverride?: 'question_paper' | 'model_answer' | 'student', studentIndexOverride?: number) => {
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;

        const phaseToUse = phaseOverride || currentPhase;
        const studentIndexToUse = studentIndexOverride !== undefined ? studentIndexOverride : currentStudentIndex;

        try {
          const { useAuthStore } = await import('./authStore');
          const token = useAuthStore.getState().sessionToken;
          const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

          if (!backendUrl) throw new Error("Missing EXPO_PUBLIC_BACKEND_URL");

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

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(body)
          });

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
            }, 1000); // 1s debounce is safe for metadata
          });
        },
        removeItem: (name) => {
          console.log(`[TRACE] scan-storage.removeItem: ${name} at ${Date.now()}`);
          return AsyncStorage.removeItem(name);
        },
      })),
      partialize: (state) => {
        // HYDRATION ISOLATION: Do not persist hydration, transient UI flags, or retake context
        const { hasHydrated, isScanning, pendingRetake, ...persistentState } = state;

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
            session.stats = recomputeStats(session);
          };

          state.savedSessions?.forEach(cleanupSession);
          cleanupSession(state.currentSession);

          // HYDRATION ISOLATION: Mark hydration complete without triggering setItem
          state.setHasHydrated(true);
        }
      },
    }
  )
);
