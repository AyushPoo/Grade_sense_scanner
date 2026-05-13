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
  
  // Actions
  addPage: (page: ScannedPage) => void;
  removePage: (phase: string, pageNumber: number, studentIndex?: number) => void;
  undoLastPage: () => void;
  setCurrentPhase: (phase: 'question_paper' | 'model_answer' | 'students') => void;
  nextStudent: () => void;
  finishSession: () => void;
  saveSession: () => void;
  clearCurrentSession: () => void;
  updateSessionStatus: (sessionId: string, status: ScanSession['status'], progress: number) => void;
  fetchSessions: () => Promise<void>;
  syncCurrentMetadata: (currentPhase: 'question_paper' | 'model_answer' | 'student', studentIndex?: number) => Promise<void>;
  setFlashMode: (mode: 'off' | 'on' | 'auto') => void;
  setAutoCaptureEnabled: (enabled: boolean) => void;
  setAutoCropEnabled: (enabled: boolean) => void;
  checkFileSystemIntegrity: () => Promise<void>;
  setHasHydrated: (val: boolean) => void;
  performPostHydrationCleanup: () => Promise<void>;
  // Batch actions
  addBatch: (batch: Batch) => void;
  deleteBatch: (batchId: string) => void;
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
      hasHydrated: false,

      setHasHydrated: (val) => set({ hasHydrated: val }),

      createSession: async (name, batchId, batchName, settings) => {
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
            student_index: 1,
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

      addPage: (page) => {
        const { currentSession, currentPhase, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        // IDENTITY PROTECTION: Prevent duplicate page insertions by ID
        const isDuplicate = (pages: ScannedPage[]) => pages.some(p => p.id === page.id);
        
        const updatedSession = { ...currentSession };
        
        if (currentPhase === 'question_paper') {
          if (isDuplicate(updatedSession.question_paper.pages)) return;
          updatedSession.question_paper.pages = [...updatedSession.question_paper.pages, page];
          updatedSession.question_paper.page_count++;
        } else if (currentPhase === 'model_answer') {
          if (isDuplicate(updatedSession.model_answer.pages)) return;
          updatedSession.model_answer.pages = [...updatedSession.model_answer.pages, page];
          updatedSession.model_answer.page_count++;
        } else {
          const updatedStudents = [...updatedSession.students];
          const student = { ...updatedStudents[currentStudentIndex] };
          if (student) {
            if (isDuplicate(student.pages)) return;
            student.pages = [...student.pages, page];
            student.page_count++;
            if (page.is_blurry) student.has_blurry_pages = true;
            updatedStudents[currentStudentIndex] = student;
            updatedSession.students = updatedStudents;
          }
        }

        updatedSession.stats = {
          ...updatedSession.stats,
          total_pages: updatedSession.stats.total_pages + 1,
          total_size_bytes: updatedSession.stats.total_size_bytes + page.file_size,
          blurry_pages: page.is_blurry ? updatedSession.stats.blurry_pages + 1 : updatedSession.stats.blurry_pages,
        };

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

      removePage: (pageNumber, phaseOverride, studentIndexOverride) => {
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
          updatedSession.stats = {
            ...updatedSession.stats,
            total_pages: updatedSession.stats.total_pages - 1,
            total_size_bytes: updatedSession.stats.total_size_bytes - removed.file_size,
            blurry_pages: removed.is_blurry ? updatedSession.stats.blurry_pages - 1 : updatedSession.stats.blurry_pages,
          };
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

      nextStudent: () => {
        const { currentSession, currentStudentIndex, savedSessions } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const nextIndex = currentStudentIndex + 1;
        
        // Ensure student exists and has an ID
        if (nextIndex >= updatedSession.students.length) {
          updatedSession.students = [
            ...updatedSession.students,
            {
              id: generateUUID(),
              student_index: nextIndex + 1,
              label: `Student #${nextIndex + 1}`,
              page_count: 0,
              has_blurry_pages: false,
              pages: [],
            },
          ];
        }

        const existingIndex = savedSessions.findIndex(s => s.session_id === updatedSession.session_id);
        const newSavedSessions = [...savedSessions];
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = updatedSession;
        }

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

      previousStudent: () => {
        const { currentStudentIndex } = get();
        if (currentStudentIndex > 0) {
          set({ currentStudentIndex: currentStudentIndex - 1 });
        }
      },

      updateStudentBarcode: (studentIndex, barcodeData) => {
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

        const existingIndex = savedSessions.findIndex(s => s.session_id === currentSession.session_id);
        const newSavedSessions = [...savedSessions];
        
        if (existingIndex > -1) {
          newSavedSessions[existingIndex] = currentSession;
        } else {
          newSavedSessions.unshift(currentSession);
        }

        set({ savedSessions: newSavedSessions });
      },

      deleteSession: (sessionId) => {
        const { savedSessions } = get();
        set({ 
          savedSessions: savedSessions.filter(s => s.session_id !== sessionId) 
        });
      },

      loadSession: (sessionId) => {
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
          updatedSession.stats = {
            ...updatedSession.stats,
            total_pages: updatedSession.stats.total_pages - 1,
            total_size_bytes: updatedSession.stats.total_size_bytes - lastPage.file_size,
            blurry_pages: lastPage.is_blurry ? updatedSession.stats.blurry_pages - 1 : updatedSession.stats.blurry_pages,
          };
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
          console.log(`[TRACE] fetchSessions: success, received ${data.sessions?.length || 0} sessions at ${Date.now()}`);
          set({ savedSessions: data.sessions });
        } catch (error) {
          console.error(`[TRACE] fetchSessions: FAILED at ${Date.now()} with error:`, error);
        }
      },

      syncCurrentMetadata: async () => {
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;

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

          if (currentPhase === 'question_paper') {
            endpoint = `${backendUrl}/api/scan-sessions/${currentSession.session_id}/upload-qp`;
            body = { pages: currentSession.question_paper.pages };
          } else if (currentPhase === 'model_answer') {
            endpoint = `${backendUrl}/api/scan-sessions/${currentSession.session_id}/upload-model`;
            body = { pages: currentSession.model_answer.pages };
          } else {
            const student = currentSession.students[currentStudentIndex];
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
        // HYDRATION ISOLATION: Do not persist hydration or transient UI flags
        const { hasHydrated, isScanning, ...persistentState } = state;
        
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
              });
            }
            if (session.model_answer?.pages) {
              session.model_answer.pages.forEach((p: any) => { 
                delete p.base64; 
                if (!p.id) p.id = generateUUID(); 
              });
            }
            if (session.students) {
              session.students.forEach((s: any) => {
                if (!s.id) s.id = generateUUID();
                if (s.pages) {
                  s.pages.forEach((p: any) => { 
                    delete p.base64; 
                    if (!p.id) p.id = generateUUID();
                  });
                }
              });
            }
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
