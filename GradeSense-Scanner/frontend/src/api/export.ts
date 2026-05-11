import { ScanSession } from '../types';
import { useScanStore } from '../store/scanStore';
import { useAuthStore } from '../store/authStore';

export async function uploadSessionToWebApp(
  session: ScanSession, 
  onProgress: (item: string, progress: number) => void
) {
  const updateStatus = useScanStore.getState().updateSessionStatus;
  
  try {
    updateStatus(session.session_id, 'uploading', 0);
    const token = useAuthStore.getState().sessionToken;
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    
    // Calculate total items (QP + Model Answer + Students)
    let totalItems = 0;
    if (session.question_paper.pages.length > 0) totalItems++;
    if (session.model_answer.pages.length > 0) totalItems++;
    totalItems += session.students.filter(s => s.pages.length > 0).length;
    
    if (totalItems === 0) {
      updateStatus(session.session_id, 'uploaded', 100);
      return;
    }

    let uploadedCount = 0;

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };

    const updateProgress = (label: string) => {
      uploadedCount++;
      const progress = uploadedCount / totalItems;
      onProgress(label, progress);
      updateStatus(session.session_id, 'uploading', Math.round(progress * 100));
    };

    // 1. Upload Question Paper
    if (session.question_paper.pages.length > 0) {
      const qpRes = await fetch(`${backendUrl}/api/scan-sessions/${session.session_id}/upload-qp`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: session.question_paper.pages })
      });
      if (!qpRes.ok) throw new Error('Failed to upload Question Paper metadata');
      updateProgress('Question Paper');
    }

    // 2. Upload Model Answer
    if (session.model_answer.pages.length > 0) {
      const maRes = await fetch(`${backendUrl}/api/scan-sessions/${session.session_id}/upload-model`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: session.model_answer.pages })
      });
      if (!maRes.ok) throw new Error('Failed to upload Model Answer metadata');
      updateProgress('Model Answer');
    }

    // 3. Upload Students
    for (let i = 0; i < session.students.length; i++) {
      const student = session.students[i];
      if (student.pages.length > 0) {
        const stuRes = await fetch(`${backendUrl}/api/scan-sessions/${session.session_id}/upload-student`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ student })
        });
        if (!stuRes.ok) throw new Error(`Failed to upload metadata for Student ${i + 1}`);
        updateProgress(`Student ${i + 1} of ${session.students.length}`);
      }
    }

    // 4. Finalize
    const compRes = await fetch(`${backendUrl}/api/scan-sessions/${session.session_id}/complete`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (!compRes.ok) throw new Error('Failed to complete session');

    updateStatus(session.session_id, 'uploaded', 100);
    console.log(`Session ${session.session_id} successfully synced to webapp.`);

  } catch (error) {
    console.error('Upload failed:', error);
    updateStatus(session.session_id, 'failed', 0);
    throw error;
  }
}
