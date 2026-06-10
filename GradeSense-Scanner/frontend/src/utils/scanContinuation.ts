import type { ScanPhase, ScanSession } from '../types';

type IdFactory = () => string;

export function prepareSessionForScanningPhase(
  session: ScanSession,
  phase: ScanPhase,
  createId: IdFactory
): { session: ScanSession; studentIndex: number } {
  if (phase !== 'students') {
    return {
      session,
      studentIndex: 0,
    };
  }

  const students = [...(session.students || [])];
  let studentIndex = students.findIndex(student => (student.pages || []).length === 0);

  if (studentIndex === -1) {
    studentIndex = students.length;
    students.push({
      id: createId(),
      student_index: studentIndex,
      label: `Student #${studentIndex + 1}`,
      page_count: 0,
      has_blurry_pages: false,
      pages: [],
    });
  }

  return {
    session: {
      ...session,
      students,
    },
    studentIndex,
  };
}
