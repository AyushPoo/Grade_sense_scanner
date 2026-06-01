import { ScanSession, ScannedPage, ScanPhase } from '../types';
import { useScanStore } from '../store/scanStore';
import { useAuthStore } from '../store/authStore';
import * as FileSystem from 'expo-file-system/legacy';
import { getBackendUrl } from '../config';

async function uploadPageFile(
  sessionId: string,
  page: ScannedPage,
  phase: ScanPhase,
  studentIndex?: number,
  retries = 3
): Promise<string> {
  const token = useAuthStore.getState().sessionToken;
  const backendUrl = getBackendUrl();
  
  if (!backendUrl) throw new Error("Missing Backend URL configuration");
  if (!token) throw new Error("No auth token — please log in again");

  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const uploadUri = page.file_path.startsWith('file://') ? page.file_path : `file://${page.file_path}`;
      
      // Use getInfoAsync — works reliably across all Expo SDK versions
      const fileInfo = await FileSystem.getInfoAsync(uploadUri);
      if (!fileInfo.exists) {
        throw new Error(`Local file not found at ${uploadUri}.`);
      }
      console.log(`[Upload] File confirmed: ${uploadUri} (${fileInfo.size} bytes)`);

      console.log(`[Upload] Attempt ${i + 1}/${retries} for page ${page.page_number} (${phase})`);
      
      const formData = new FormData();
      formData.append('file', {
        uri: uploadUri,
        name: `page_${page.page_number}.jpg`,
        type: 'image/jpeg',
      } as any);

      formData.append('page_number', page.page_number.toString());
      formData.append('phase', phase);
      formData.append('mode', 'enhanced');
      if (studentIndex !== undefined) {
        formData.append('student_index', studentIndex.toString());
      }

      const response = await fetch(`${backendUrl}/api/scan-sessions/${sessionId}/upload-file`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        return data.file_url;
      }
      
      const errorText = await response.text();
      lastError = new Error(`Upload failed with status ${response.status}: ${errorText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Retry ${i + 1} for page ${page.page_number} failed:`, lastError.message);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }

  throw lastError || new Error(`Failed to upload image file after ${retries} retries`);
}

export async function uploadSessionToWebApp(
  session: ScanSession, 
  onProgress: (item: string, progress: number) => void
) {
  const updateStatus = useScanStore.getState().updateSessionStatus;
  const updateSessionId = useScanStore.getState().updateSessionId;
  let currentSessionId = session.session_id;
  
  try {
    updateStatus(currentSessionId, 'uploading', 0);
    const token = useAuthStore.getState().sessionToken;
    const backendUrl = getBackendUrl();
    
    if (!backendUrl) throw new Error("Missing Backend URL configuration");
    if (!token) throw new Error("No auth token — please log in again");

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };

    // 0. Register local session if offline
    if (currentSessionId.startsWith('local_')) {
      onProgress('Registering session on server...', 0.05);
      
      const createResponse = await fetch(`${backendUrl}/api/scan-sessions/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          session_name: session.session_name,
          batch_id: session.batch_id,
          settings: session.settings,
          subject_id: session.subject_id || null,
          total_marks: session.total_marks || null,
          exam_date: session.exam_date || null
        })
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to register session on server: Status ${createResponse.status} - ${errorText}`);
      }

      const createData = await createResponse.json();
      const backendSessionId = createData.session_id;

      // Rename locally in Zustand store
      updateSessionId(currentSessionId, backendSessionId);
      currentSessionId = backendSessionId;
    }

    // Calculate total operations (Pages + Metadata Syncs)
    let totalOps = 0;
    const qpPages = session.question_paper.pages;
    const maPages = session.model_answer.pages;
    const studentsWithPages = session.students.filter(s => s.pages.length > 0);
    
    totalOps += qpPages.length + (qpPages.length > 0 ? 1 : 0);
    totalOps += maPages.length + (maPages.length > 0 ? 1 : 0);
    for (const s of studentsWithPages) {
      totalOps += s.pages.length + 1;
    }
    totalOps += 1; // Complete session
    
    let completedOps = 0;

    const stepProgress = (label: string) => {
      completedOps++;
      const progress = completedOps / totalOps;
      onProgress(label, progress);
      updateStatus(currentSessionId, 'uploading', Math.round(progress * 100));
    };

    // 1. Upload Question Paper Pages
    if (qpPages.length > 0) {
      const updatedPages = [];
      for (const page of qpPages) {
        stepProgress(`Uploading QP Page ${page.page_number}`);
        const fileUrl = await uploadPageFile(currentSessionId, page, 'question_paper');
        updatedPages.push({ ...page, file_url: fileUrl });
      }
      
      stepProgress('Syncing QP Metadata');
      const qpRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-qp`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: updatedPages })
      });
      if (!qpRes.ok) {
        const txt = await qpRes.text();
        throw new Error(`Failed to sync QP metadata: Status ${qpRes.status} - ${txt}`);
      }
    }

    // 2. Upload Model Answer Pages
    if (maPages.length > 0) {
      const updatedPages = [];
      for (const page of maPages) {
        stepProgress(`Uploading Model Page ${page.page_number}`);
        const fileUrl = await uploadPageFile(currentSessionId, page, 'model_answer');
        updatedPages.push({ ...page, file_url: fileUrl });
      }
      
      stepProgress('Syncing Model Metadata');
      const maRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-model`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: updatedPages })
      });
      if (!maRes.ok) {
        const txt = await maRes.text();
        throw new Error(`Failed to sync Model Answer metadata: Status ${maRes.status} - ${txt}`);
      }
    }

    // 3. Upload Student Pages
    for (let i = 0; i < session.students.length; i++) {
      const student = session.students[i];
      if (student.pages.length > 0) {
        const updatedPages = [];
        for (const page of student.pages) {
          stepProgress(`Student ${i + 1}: Page ${page.page_number}`);
          const fileUrl = await uploadPageFile(currentSessionId, page, 'students', i);
          updatedPages.push({ ...page, file_url: fileUrl });
        }
        
        stepProgress(`Syncing Student ${i + 1} Metadata`);
        const stRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-student`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ student: { ...student, pages: updatedPages } })
        });
        if (!stRes.ok) {
          const txt = await stRes.text();
          throw new Error(`Failed to sync Student #${i + 1} metadata: Status ${stRes.status} - ${txt}`);
        }
      }
    }

    // 4. Finalize
    stepProgress('Finalizing session');
    const compRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/complete`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (!compRes.ok) {
      const txt = await compRes.text();
      throw new Error(`Failed to finalize/grade session: Status ${compRes.status} - ${txt}`);
    }

    let examId = undefined;
    try {
      const compData = await compRes.json();
      examId = compData.exam_id;
    } catch (_) {}

    updateStatus(currentSessionId, 'syncing', 100, examId);
    console.log(`Session ${currentSessionId} successfully synced via multipart upload. exam_id=${examId}`);

  } catch (error) {
    console.error('Upload failed:', error);
    updateStatus(currentSessionId, 'failed', 0);
    throw error;
  }
}
