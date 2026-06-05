import type { ReviewFileItem, ReviewFileSlide } from '../types/review';
import type { ScannedPage, ScanSession, ScannedStudent } from '../types';
import { isPdfScannedPage } from './scannedPageAssets';

interface ActiveStudentIdentity {
  studentName?: string | null;
  studentRollNumber?: string | null;
}

type LocalDocumentKind = 'question_paper' | 'model_answer' | 'answer_sheet';

export function buildReviewFileSlides(files: ReviewFileItem[]): ReviewFileSlide[] {
  return files
    .map((file, index) => {
      const type = getFileType(file);
      return {
        id: file.id,
        title: getFileTitle(type),
        signedUrl: file.signedUrl,
        annotationSignedUrl: file.annotationSignedUrl,
        contentType: file.contentType,
        originalName: file.originalName,
        type,
        order: getFileOrder(type, index),
      };
    })
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
