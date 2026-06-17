import type { ReviewFileItem, ReviewFileSlide } from '../types/review';
import type { ScannedPage, ScanSession, ScannedStudent } from '../types';
import { isPdfScannedPage } from './scannedPageAssets';

interface ActiveStudentIdentity {
  studentName?: string | null;
  studentRollNumber?: string | null;
}

type LocalDocumentKind = 'question_paper' | 'model_answer' | 'answer_sheet';

export function buildReviewFileSlides(files: ReviewFileItem[]): ReviewFileSlide[] {
  const nonStudentSlides: (ReviewFileSlide & { order: number })[] = [];
  const studentFiles: ReviewFileItem[] = [];

  files.forEach((file, index) => {
    const type = getFileType(file);
    if (type !== 'student') {
      nonStudentSlides.push({
        id: file.id,
        title: getFileTitle(type),
        signedUrl: file.signedUrl || '',
        annotationSignedUrl: file.annotationSignedUrl || null,
        contentType: file.contentType,
        originalName: file.originalName,
        type,
        order: getFileOrder(type, index),
      });
    } else {
      studentFiles.push(file);
    }
  });

  // Separate student files into clean and graded
  const gradedFiles: ReviewFileItem[] = [];
  const cleanFiles: ReviewFileItem[] = [];

  studentFiles.forEach(file => {
    const isGraded = file.originalName?.toLowerCase().includes('graded') || 
                     file.id?.toLowerCase().includes('graded') ||
                     (file.kind || '').toLowerCase().includes('graded');
    if (isGraded) {
      gradedFiles.push(file);
    } else {
      cleanFiles.push(file);
    }
  });

  // Sort both arrays to pair them properly
  const sortByOriginalName = (a: ReviewFileItem, b: ReviewFileItem) => {
    const nameA = a.originalName || '';
    const nameB = b.originalName || '';
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  };

  cleanFiles.sort(sortByOriginalName);
  gradedFiles.sort(sortByOriginalName);

  const studentSlides: (ReviewFileSlide & { order: number })[] = [];

  // Pair them up
  if (cleanFiles.length === gradedFiles.length) {
    // Perfect 1-to-1 matching by index
    cleanFiles.forEach((cleanFile, idx) => {
      const gradedFile = gradedFiles[idx];
      studentSlides.push({
        id: gradedFile.id || cleanFile.id,
        title: getFileTitle('student'),
        // original view (showOriginal = true) shows the uncropped raw photo: cleanFile.annotationSignedUrl || cleanFile.signedUrl
        signedUrl: cleanFile.annotationSignedUrl || cleanFile.signedUrl || '',
        // graded view (showOriginal = false) shows the graded PDF: gradedFile.signedUrl || cleanFile.signedUrl
        annotationSignedUrl: gradedFile.signedUrl || cleanFile.signedUrl || null,
        contentType: gradedFile.contentType || cleanFile.contentType,
        originalName: gradedFile.originalName || cleanFile.originalName,
        type: 'student',
        order: getFileOrder('student', idx),
      });
    });
  } else if (cleanFiles.length > 0 && gradedFiles.length === 0) {
    // Only clean files exist (e.g. not graded yet)
    cleanFiles.forEach((cleanFile, idx) => {
      studentSlides.push({
        id: cleanFile.id,
        title: getFileTitle('student'),
        // original view shows raw uncropped camera photo
        signedUrl: cleanFile.annotationSignedUrl || cleanFile.signedUrl || '',
        // graded view falls back to clean cropped page since there is no graded file yet
        annotationSignedUrl: cleanFile.signedUrl || null,
        contentType: cleanFile.contentType,
        originalName: cleanFile.originalName,
        type: 'student',
        order: getFileOrder('student', idx),
      });
    });
  } else if (gradedFiles.length > 0 && cleanFiles.length === 0) {
    // Only graded files exist
    gradedFiles.forEach((gradedFile, idx) => {
      studentSlides.push({
        id: gradedFile.id,
        title: getFileTitle('student'),
        signedUrl: gradedFile.signedUrl || '',
        annotationSignedUrl: gradedFile.signedUrl || null,
        contentType: gradedFile.contentType,
        originalName: gradedFile.originalName,
        type: 'student',
        order: getFileOrder('student', idx),
      });
    });
  } else {
    // Clean and graded counts are different, try matching by substring or fallback to index-based pairing
    const pairedGradedIndices = new Set<number>();
    
    cleanFiles.forEach((cleanFile, cIdx) => {
      const cleanBaseName = (cleanFile.originalName || '').replace(/\.[^/.]+$/, "").toLowerCase();
      let bestMatchIdx = -1;
      
      for (let gIdx = 0; gIdx < gradedFiles.length; gIdx++) {
        if (pairedGradedIndices.has(gIdx)) continue;
        const gradedName = (gradedFiles[gIdx].originalName || '').toLowerCase();
        if (gradedName.includes(cleanBaseName)) {
          bestMatchIdx = gIdx;
          break;
        }
      }
      
      if (bestMatchIdx === -1 && gradedFiles.length > cIdx && !pairedGradedIndices.has(cIdx)) {
        bestMatchIdx = cIdx;
      }

      if (bestMatchIdx !== -1) {
        pairedGradedIndices.add(bestMatchIdx);
        const gradedFile = gradedFiles[bestMatchIdx];
        studentSlides.push({
          id: gradedFile.id || cleanFile.id,
          title: getFileTitle('student'),
          signedUrl: cleanFile.annotationSignedUrl || cleanFile.signedUrl || '',
          annotationSignedUrl: gradedFile.signedUrl || cleanFile.signedUrl || null,
          contentType: gradedFile.contentType || cleanFile.contentType,
          originalName: gradedFile.originalName || cleanFile.originalName,
          type: 'student',
          order: getFileOrder('student', cIdx),
        });
      } else {
        studentSlides.push({
          id: cleanFile.id,
          title: getFileTitle('student'),
          signedUrl: cleanFile.annotationSignedUrl || cleanFile.signedUrl || '',
          annotationSignedUrl: cleanFile.signedUrl || null,
          contentType: cleanFile.contentType,
          originalName: cleanFile.originalName,
          type: 'student',
          order: getFileOrder('student', cIdx),
        });
      }
    });

    gradedFiles.forEach((gradedFile, gIdx) => {
      if (!pairedGradedIndices.has(gIdx)) {
        studentSlides.push({
          id: gradedFile.id,
          title: getFileTitle('student'),
          signedUrl: gradedFile.signedUrl || '',
          annotationSignedUrl: gradedFile.signedUrl || null,
          contentType: gradedFile.contentType,
          originalName: gradedFile.originalName,
          type: 'student',
          order: getFileOrder('student', cleanFiles.length + gIdx),
        });
      }
    });
  }

  const allSlides = [...nonStudentSlides, ...studentSlides];
  return allSlides
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...slide }) => slide);
}

export function buildLocalReviewFiles(
  session: Partial<ScanSession> | null | undefined,
  activeStudent?: ActiveStudentIdentity | null
): ReviewFileItem[] {
  if (!session) {
    return [];
  }

  const localFiles: ReviewFileItem[] = [
    ...buildFilesFromPages(session.question_paper?.pages, 'question_paper', 'local-question'),
    ...buildFilesFromPages(session.model_answer?.pages, 'model_answer', 'local-model'),
  ];

  const student = findLocalStudent(session.students, activeStudent);
  localFiles.push(...buildFilesFromPages(student?.pages, 'answer_sheet', 'local-student'));

  return localFiles;
}

export function mergeReviewFiles(apiFiles: ReviewFileItem[], localFiles: ReviewFileItem[]): ReviewFileItem[] {
  const seen = new Set<string>();
  const merged: ReviewFileItem[] = [];
  const apiDocumentTypes = new Set(apiFiles.map(getFileType));
  const localFallbackFiles = localFiles.filter(file => !apiDocumentTypes.has(getFileType(file)));

  for (const file of [...apiFiles, ...localFallbackFiles]) {
    const key = fileKey(file);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(file);
  }

  return merged;
}

function getFileType(file: ReviewFileItem): ReviewFileSlide['type'] {
  const source = [
    file.kind,
    file.fileType,
    file.originalName,
    file.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[-\s]+/g, '_');

  if (source.includes('question_paper') || source.includes('question') || source.includes('qp')) {
    return 'question';
  }

  if (source.includes('model_answer') || source.includes('model')) {
    return 'model';
  }

  if (source.includes('student_answer_sheet') || source.includes('answer_sheet') || source.includes('student')) {
    return 'student';
  }

  return 'other';
}

function getFileTitle(type: ReviewFileSlide['type']): string {
  switch (type) {
    case 'question':
      return 'Question Paper';
    case 'model':
      return 'Model Answer';
    case 'student':
      return 'Student Sheet';
    default:
      return 'Paper File';
  }
}

function getFileOrder(type: ReviewFileSlide['type'], index: number): number {
  switch (type) {
    case 'question':
      return 0;
    case 'model':
      return 1;
    case 'student':
      return 2;
    default:
      return 10 + index;
  }
}

function buildFilesFromPages(
  pages: ScannedPage[] | undefined,
  kind: LocalDocumentKind,
  idPrefix: string
): ReviewFileItem[] {
  return (pages || [])
    .filter(page => Boolean(page.file_path))
    .map(page => ({
      id: `${idPrefix}-${page.id || page.ui_id || page.page_number}`,
      kind,
      fileType: kind,
      originalName: page.original_name || `${kind}_page_${page.page_number}`,
      contentType: isPdfScannedPage(page) ? 'application/pdf' : page.content_type,
      signedUrl: page.file_path,
      annotationSignedUrl: null,
    }));
}

function findLocalStudent(
  students: ScannedStudent[] | undefined,
  activeStudent?: ActiveStudentIdentity | null
): ScannedStudent | undefined {
  if (!students?.length) {
    return undefined;
  }

  const activeRoll = normalize(activeStudent?.studentRollNumber);
  const activeName = normalize(activeStudent?.studentName);

  if (activeRoll) {
    const rollMatch = students.find(student => normalize(student.roll_number) === activeRoll);
    if (rollMatch) {
      return rollMatch;
    }
  }

  if (activeName) {
    const nameMatch = students.find(student => {
      const studentName = normalize(student.name || student.label);
      return studentName === activeName;
    });
    if (nameMatch) {
      return nameMatch;
    }
  }

  return students[0];
}

function fileKey(file: ReviewFileItem): string {
  return file.signedUrl || `${file.kind || file.fileType || 'file'}:${file.id}`;
}

function normalize(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}
