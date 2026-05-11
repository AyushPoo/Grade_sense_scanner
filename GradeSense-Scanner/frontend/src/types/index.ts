// Type definitions for GradeSense Scanner

export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role?: string;
  org_id?: string;
  org_name?: string;
}

export interface Batch {
  batch_id: string;
  name: string;
  student_count: number;
}

export interface Student {
  student_id?: string;
  roll_number?: string;
  name?: string;
}

export interface ScannedPage {
  page_number: number;
  file_path: string;
  file_size: number;
  is_blurry: boolean;
  sharpness_score: number;
  captured_at: string;
  base64?: string;
}

export interface ScannedStudent {
  student_index: number;
  label: string;
  barcode_data?: {
    type: string;
    data: string;
    matched_name?: string;
  };
  page_count: number;
  has_blurry_pages: boolean;
  pages: ScannedPage[];
}

export interface ScanSessionSettings {
  auto_capture: boolean;
  barcode_detection: boolean;
  blur_detection: boolean;
  flash_mode: 'off' | 'on' | 'auto';
  scan_question_paper: boolean;
  scan_model_answer: boolean;
  page_mode: 'single' | 'double'; // single = 1 page per capture, double = 2 pages (split left/right)
}

export interface ScanSession {
  session_id: string;
  session_name: string;
  batch_id: string;
  batch_name: string;
  org_id?: string;
  user_id?: string;
  created_at: string;
  status: 'scanning' | 'ready' | 'uploading' | 'uploaded' | 'failed';
  upload_progress: number;
  settings: ScanSessionSettings;
  question_paper: {
    page_count: number;
    pages: ScannedPage[];
  };
  model_answer: {
    page_count: number;
    pages: ScannedPage[];
  };
  students: ScannedStudent[];
  stats: {
    total_students: number;
    total_pages: number;
    total_size_bytes: number;
    blurry_pages: number;
    scanning_duration_seconds: number;
    avg_time_per_student_seconds: number;
  };
}

export type ScanPhase = 'question_paper' | 'model_answer' | 'students';

export interface CaptureState {
  isStable: boolean;
  isDocumentDetected: boolean;
  isSharp: boolean;
  motionLevel: number;
  stabilityProgress: number;
}
