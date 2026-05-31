export interface SubmissionListItem {
  id: string;
  studentName: string;
  studentRollNumber: string;
  totalScore: number;
  totalMarks: number;
  status: string;
}

export interface ScoreItem {
  id: string;
  questionNumber: string;
  obtainedMarks: number;
  maxMarks: number;
  questionText: string;
  aiFeedback: string | null;
  teacherCorrection: string | null;
  studentAnswerText?: string | null;
}

export interface ReviewFileItem {
  id: string;
  signedUrl: string | null;
  annotationSignedUrl: string | null;
  kind?: string | null;
  fileType?: string | null;
  originalName?: string | null;
}

export interface ReviewFileSlide {
  id: string;
  title: string;
  signedUrl: string | null;
  annotationSignedUrl: string | null;
  type: 'question' | 'model' | 'student' | 'other';
}
