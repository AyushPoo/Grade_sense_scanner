import { ScanSession, ScannedPage, ScanPhase } from '../types';
import { useScanStore } from '../store/scanStore';
import { useAuthStore } from '../store/authStore';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getBackendUrl } from '../config';
import { isPdfScannedPage } from '../utils/scannedPageAssets';
import { mapWithConcurrency } from '../utils/concurrency';

interface UploadedPageFile {
  fileUrl: string;
  contentType: string;
  originalName?: string;
}

interface UploadAsset {
  uri: string;
  contentType: string;
  fileName: string;
  tempUri?: string;
  size?: number;
}

interface UploadPageTask {
  page: ScannedPage;
  pageIndex: number;
  phase: ScanPhase;
  label: string;
  studentIndex?: number;
}

const MAX_PARALLEL_PAGE_UPLOADS = 3;
const OPTIMIZE_IMAGE_ABOVE_BYTES = 900 * 1024;
const UPLOAD_IMAGE_COMPRESS = 0.78;

async function getExistingFileInfo(uri: string) {
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) {
    throw new Error(`Local file not found at ${uri}.`);
  }
  return fileInfo;
}

async function prepareUploadAsset(page: ScannedPage): Promise<UploadAsset> {
  const uploadUri = page.file_path.startsWith('file://') || page.file_path.startsWith('content://')
    ? page.file_path
    : `file://${page.file_path}`;
  const isPdf = isPdfScannedPage(page);
  const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
  const fileName = page.original_name || `page_${page.page_number}.${isPdf ? 'pdf' : 'jpg'}`;
  const fileInfo = await getExistingFileInfo(uploadUri);

  if (isPdf || !fileInfo.size || fileInfo.size <= OPTIMIZE_IMAGE_ABOVE_BYTES) {
    return { uri: uploadUri, contentType, fileName, size: fileInfo.size };
  }

  try {
    const optimized = await ImageManipulator.manipulateAsync(
      uploadUri,
      [],
      {
        compress: UPLOAD_IMAGE_COMPRESS,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    const optimizedInfo = await getExistingFileInfo(optimized.uri);
    if (optimizedInfo.size && optimizedInfo.size < fileInfo.size) {
      console.log(`[Upload] Optimized ${fileName}: ${fileInfo.size} -> ${optimizedInfo.size} bytes`);
      return {
        uri: optimized.uri,
        contentType,
        fileName,
        tempUri: optimized.uri,
        size: optimizedInfo.size,
      };
    }
    await FileSystem.deleteAsync(optimized.uri, { idempotent: true }).catch(() => {});
  } catch (err) {
    console.warn('[Upload] Image optimization skipped:', err instanceof Error ? err.message : String(err));
  }

  return { uri: uploadUri, contentType, fileName, size: fileInfo.size };
}

async function uploadPageFile(
  sessionId: string,
  page: ScannedPage,
  phase: ScanPhase,
  studentIndex?: number,
  retries = 3
): Promise<UploadedPageFile> {
  const token = useAuthStore.getState().sessionToken;
  const backendUrl = getBackendUrl();

  if (!backendUrl) throw new Error('Missing Backend URL configuration');
  if (!token) throw new Error('No auth token - please log in again');

  let lastError;
  for (let i = 0; i < retries; i += 1) {
    let asset: UploadAsset | null = null;
    try {
      const startedAt = Date.now();
      asset = await prepareUploadAsset(page);
      console.log(`[Upload] File confirmed: ${asset.uri} (${asset.size || 0} bytes)`);
      console.log(`[Upload] Attempt ${i + 1}/${retries} for page ${page.page_number} (${phase})`);

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.fileName,
        type: asset.contentType,
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
        console.log(`[Upload] Uploaded page ${page.page_number} (${phase}) in ${Date.now() - startedAt}ms`);
        return {
          fileUrl: data.file_url,
          contentType: data.content_type || asset.contentType,
          originalName: data.original_name || page.original_name || asset.fileName,
        };
      }

      const errorText = await response.text();
      lastError = new Error(`Upload failed with status ${response.status}: ${errorText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Retry ${i + 1} for page ${page.page_number} failed:`, lastError.message);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    } finally {
      if (asset?.tempUri) {
        await FileSystem.deleteAsync(asset.tempUri, { idempotent: true }).catch(() => {});
      }
    }
  }

  throw lastError || new Error(`Failed to upload file after ${retries} retries`);
}

async function uploadPageTasks(
  sessionId: string,
  tasks: UploadPageTask[],
  onPageUploaded: (label: string) => void
): Promise<(UploadedPageFile & { page: ScannedPage; pageIndex: number; studentIndex?: number })[]> {
  return mapWithConcurrency(tasks, MAX_PARALLEL_PAGE_UPLOADS, async task => {
    const uploaded = await uploadPageFile(sessionId, task.page, task.phase, task.studentIndex);
    onPageUploaded(task.label);
    return {
      ...uploaded,
      page: task.page,
      pageIndex: task.pageIndex,
      studentIndex: task.studentIndex,
    };
  });
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

    if (!backendUrl) throw new Error('Missing Backend URL configuration');
    if (!token) throw new Error('No auth token - please log in again');

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };

    if (currentSessionId.startsWith('local_')) {
      onProgress('Registering session on server...', 0.05);

      const createResponse = await fetch(`${backendUrl}/api/scan-sessions/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          session_name: session.session_name,
          batch_id: session.batch_id,
          batch_name: session.batch_name,
          settings: session.settings,
          subject_id: session.subject_id || null,
          total_marks: session.total_marks || null,
          exam_date: session.exam_date || null,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to register session on server: Status ${createResponse.status} - ${errorText}`);
      }

      const createData = await createResponse.json();
      const backendSessionId = createData.session_id;
      updateSessionId(currentSessionId, backendSessionId);
      currentSessionId = backendSessionId;
    }

    const qpPages = session.question_paper.pages;
    const maPages = session.model_answer.pages;
    const studentsWithPages = session.students
      .map((student, studentIndex) => ({ student, studentIndex }))
      .filter(({ student }) => student.pages.length > 0);

    let totalOps = qpPages.length + maPages.length + 1;
    totalOps += qpPages.length > 0 ? 1 : 0;
    totalOps += maPages.length > 0 ? 1 : 0;
    studentsWithPages.forEach(({ student }) => {
      totalOps += student.pages.length + 1;
    });

    let completedOps = 0;
    const stepProgress = (label: string) => {
      completedOps += 1;
      const progress = completedOps / totalOps;
      onProgress(label, progress);
      updateStatus(currentSessionId, 'uploading', Math.round(progress * 100));
    };

    if (qpPages.length > 0) {
      onProgress('Uploading question paper pages...', completedOps / totalOps);
      const uploadedPages = await uploadPageTasks(
        currentSessionId,
        qpPages.map((page, pageIndex) => ({
          page,
          pageIndex,
          phase: 'question_paper',
          label: `Uploaded QP Page ${page.page_number}`,
        })),
        stepProgress
      );
      const updatedPages = uploadedPages.map(uploaded => ({
        ...uploaded.page,
        file_url: uploaded.fileUrl,
        content_type: uploaded.contentType,
        original_name: uploaded.originalName,
      }));

      stepProgress('Syncing QP Metadata');
      const qpRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-qp`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: updatedPages }),
      });
      if (!qpRes.ok) {
        const txt = await qpRes.text();
        throw new Error(`Failed to sync QP metadata: Status ${qpRes.status} - ${txt}`);
      }
    }

    if (maPages.length > 0) {
      onProgress('Uploading model answer pages...', completedOps / totalOps);
      const uploadedPages = await uploadPageTasks(
        currentSessionId,
        maPages.map((page, pageIndex) => ({
          page,
          pageIndex,
          phase: 'model_answer',
          label: `Uploaded Model Page ${page.page_number}`,
        })),
        stepProgress
      );
      const updatedPages = uploadedPages.map(uploaded => ({
        ...uploaded.page,
        file_url: uploaded.fileUrl,
        content_type: uploaded.contentType,
        original_name: uploaded.originalName,
      }));

      stepProgress('Syncing Model Metadata');
      const maRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-model`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pages: updatedPages }),
      });
      if (!maRes.ok) {
        const txt = await maRes.text();
        throw new Error(`Failed to sync Model Answer metadata: Status ${maRes.status} - ${txt}`);
      }
    }

    const studentUploadTasks: UploadPageTask[] = [];
    studentsWithPages.forEach(({ student, studentIndex }) => {
      student.pages.forEach((page, pageIndex) => {
        studentUploadTasks.push({
          page,
          pageIndex,
          phase: 'students',
          studentIndex,
          label: `Uploaded Student ${studentIndex + 1}: Page ${page.page_number}`,
        });
      });
    });

    if (studentUploadTasks.length > 0) {
      onProgress('Uploading student papers...', completedOps / totalOps);
    }
    const uploadedStudentPages = await uploadPageTasks(currentSessionId, studentUploadTasks, stepProgress);

    const uploadedByStudent = new Map<number, typeof uploadedStudentPages>();
    uploadedStudentPages.forEach(uploaded => {
      if (uploaded.studentIndex === undefined) return;
      const existing = uploadedByStudent.get(uploaded.studentIndex) || [];
      existing[uploaded.pageIndex] = uploaded;
      uploadedByStudent.set(uploaded.studentIndex, existing);
    });

    for (const { student, studentIndex } of studentsWithPages) {
      const updatedPages = (uploadedByStudent.get(studentIndex) || []).map(uploaded => ({
        ...uploaded.page,
        file_url: uploaded.fileUrl,
        content_type: uploaded.contentType,
        original_name: uploaded.originalName,
      }));

      stepProgress(`Syncing Student ${studentIndex + 1} Metadata`);
      const stRes = await fetch(`${backendUrl}/api/scan-sessions/${currentSessionId}/upload-student`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ student: { ...student, pages: updatedPages } }),
      });
      if (!stRes.ok) {
        const txt = await stRes.text();
        throw new Error(`Failed to sync Student #${studentIndex + 1} metadata: Status ${stRes.status} - ${txt}`);
      }
    }

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
    } catch {}

    updateStatus(currentSessionId, 'syncing', 100, examId);
    console.log(`Session ${currentSessionId} successfully synced via multipart upload. exam_id=${examId}`);
  } catch (error) {
    console.error('Upload failed:', error);
    updateStatus(currentSessionId, 'failed', 0);
    throw error;
  }
}
