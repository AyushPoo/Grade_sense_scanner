import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScanSession, ScanPhase, ScannedPage, ScanSessionSettings, ScannedStudent, Batch } from '../types';
import * as FileSystem from 'expo-file-system/legacy';

// Simple UUID generator
const generateUUID = () => {
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
  createSession: (name: string, batchId: string, batchName: string, settings: ScanSessionSettings) => void;
  setCurrentPhase: (phase: ScanPhase) => void;
  addPage: (page: ScannedPage) => void;
  removePage: (pageNumber: number, phaseOverride?: ScanPhase, studentIndexOverride?: number) => void;
  nextStudent: () => void;
  previousStudent: () => void;
  updateStudentBarcode: (studentIndex: number, barcodeData: any) => void;
  finishSession: () => void;
  saveSession: () => void;
  deleteSession: (sessionId: string) => void;
  loadSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: ScanSession['status'], progress?: number) => void;
  setFlashMode: (mode: 'off' | 'on' | 'auto') => void;
  setAutoCaptureEnabled: (enabled: boolean) => void;
  setAutoCropEnabled: (enabled: boolean) => void;
  clearCurrentSession: () => void;
  undoLastPage: () => void;
  // Batch actions
  addBatch: (batch: Batch) => void;
  deleteBatch: (batchId: string) => void;
  fetchSessions: () => Promise<void>;
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
            student_index: 1,
            label: 'Student #1',
            page_count: 0,
            has_blurry_pages: false,
            pages: [],
          }];
          
          set({ 
            currentSession: session, 
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
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        
        if (currentPhase === 'question_paper') {
          updatedSession.question_paper.pages.push(page);
          updatedSession.question_paper.page_count++;
        } else if (currentPhase === 'model_answer') {
          updatedSession.model_answer.pages.push(page);
          updatedSession.model_answer.page_count++;
        } else {
          const student = updatedSession.students[currentStudentIndex];
          if (student) {
            student.pages.push(page);
            student.page_count++;
            if (page.is_blurry) student.has_blurry_pages = true;
          }
        }

        // Update stats
        updatedSession.stats.total_pages++;
        updatedSession.stats.total_size_bytes += page.file_size;
        if (page.is_blurry) updatedSession.stats.blurry_pages++;

        set({ currentSession: updatedSession });
      },

      removePage: (pageNumber, phaseOverride, studentIndexOverride) => {
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const phaseToUse = phaseOverride || currentPhase;
        
        if (phaseToUse === 'question_paper') {
          const pageIndex = updatedSession.question_paper.pages.findIndex(p => p.page_number === pageNumber);
          if (pageIndex > -1) {
            const [removed] = updatedSession.question_paper.pages.splice(pageIndex, 1);
            updatedSession.question_paper.page_count--;
            updatedSession.stats.total_pages--;
            updatedSession.stats.total_size_bytes -= removed.file_size;
            if (removed.is_blurry) updatedSession.stats.blurry_pages--;
          }
        } else if (phaseToUse === 'model_answer') {
          const pageIndex = updatedSession.model_answer.pages.findIndex(p => p.page_number === pageNumber);
          if (pageIndex > -1) {
            const [removed] = updatedSession.model_answer.pages.splice(pageIndex, 1);
            updatedSession.model_answer.page_count--;
            updatedSession.stats.total_pages--;
            updatedSession.stats.total_size_bytes -= removed.file_size;
            if (removed.is_blurry) updatedSession.stats.blurry_pages--;
          }
        } else {
          const studentIdx = studentIndexOverride !== undefined ? studentIndexOverride : currentStudentIndex;
          const student = updatedSession.students[studentIdx];
          if (student) {
            const pageIndex = student.pages.findIndex(p => p.page_number === pageNumber);
            if (pageIndex > -1) {
              const [removed] = student.pages.splice(pageIndex, 1);
              student.page_count--;
              updatedSession.stats.total_pages--;
              updatedSession.stats.total_size_bytes -= removed.file_size;
              if (removed.is_blurry) {
                updatedSession.stats.blurry_pages--;
                student.has_blurry_pages = student.pages.some(p => p.is_blurry);
              }
            }
          }
        }

        set({ currentSession: updatedSession });
      },

      nextStudent: () => {
        const { currentSession, currentStudentIndex } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        const newIndex = currentStudentIndex + 1;
        
        // Create new student if needed
        if (newIndex >= updatedSession.students.length) {
          updatedSession.students.push({
            student_index: newIndex + 1,
            label: `Student #${newIndex + 1}`,
            page_count: 0,
            has_blurry_pages: false,
            pages: [],
          });
        }
        
        updatedSession.stats.total_students = updatedSession.students.length;
        
        set({ 
          currentSession: updatedSession, 
          currentStudentIndex: newIndex,
          currentPhase: 'students',
        });
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
        const { currentSession, currentPhase, currentStudentIndex } = get();
        if (!currentSession) return;

        const updatedSession = { ...currentSession };
        let lastPage: ScannedPage | undefined;
        
        if (currentPhase === 'question_paper' && updatedSession.question_paper.pages.length > 0) {
          lastPage = updatedSession.question_paper.pages.pop();
          if (lastPage) updatedSession.question_paper.page_count--;
        } else if (currentPhase === 'model_answer' && updatedSession.model_answer.pages.length > 0) {
          lastPage = updatedSession.model_answer.pages.pop();
          if (lastPage) updatedSession.model_answer.page_count--;
        } else {
          const student = updatedSession.students[currentStudentIndex];
          if (student && student.pages.length > 0) {
            lastPage = student.pages.pop();
            if (lastPage) {
              student.page_count--;
              student.has_blurry_pages = student.pages.some(p => p.is_blurry);
            }
          }
        }

        if (lastPage) {
          updatedSession.stats.total_pages--;
          updatedSession.stats.total_size_bytes -= lastPage.file_size;
          if (lastPage.is_blurry) updatedSession.stats.blurry_pages--;
        }

        set({ currentSession: updatedSession });
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
          set({ savedSessions: data.sessions });
        } catch (error) {
          console.error("Error fetching sessions:", error);
        }
      },
    }),
    {
      name: 'scan-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        savedSessions: state.savedSessions,
        savedBatches: state.savedBatches,
      }),
    }
  )
);
