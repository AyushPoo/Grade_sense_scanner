// Type definitions for GradeSense

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

export interface Subject {
  id: string;
  name: string;
  classStandard?: string;
}

export interface Student {
  student_id?: string;
  roll_number?: string;
  name?: string;
}

export interface ScannedPage {
  id: string; // Globally unique ID (UUID)
  ui_id: string; // Deterministic ID for UI reconciliation
  page_number: number;
  file_path: string;
  file_url?: string; // GCS URL for cropped/enhanced page
  source_type?: 'camera' | 'pdf' | 'image';
  scanner_engine?: 'camera' | 'native_document_scanner' | 'import';
  content_type?: string;
  original_name?: string;
  original_file_path?: string; // pristine colored crop
  raw_file_path?: string; // absolute raw camera image (uncropped)
  raw_file_url?: string; // GCS URL for raw photo (uncropped)
  crop_quad?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  }; // the detected points used for the crop
  crop_applied?: boolean;
  crop_confidence?: number;
  orientation_degrees?: 0 | 90 | 180 | 270;
  needs_orientation_review?: boolean;
  split_source_page_id?: string;
  split_part?: 'left' | 'right' | 'top' | 'bottom';
  filter_mode?: 'original' | 'grayscale' | 'high_contrast' | 'adaptive_threshold';
  file_size: number;
  is_blurry: boolean;
  sharpness_score: number;
  captured_at: string;
  base64?: string;
  sync_status?: 'synced' | 'unsynced' | 'failed';
  diagnostics?: {
    detectorUsed: string;
    confidence: number;
    accepted: boolean;
    reason?: string;
    cropQuad?: string;
    outputSize?: string;
  };
}

export interface ScannedStudent {
  id: string; // Unique student ID
  student_index: number;
  label: string;
  barcode_data?: {
    type: string;
    data: string;
    matched_name?: string;
  };
  name?: string | null;
  roll_number?: string | null;
  page_count: number;
  has_blurry_pages: boolean;
  pages: ScannedPage[];
  sync_status?: 'synced' | 'unsynced' | 'failed';
}

export interface ScanSessionSettings {
  auto_capture: boolean;
  auto_crop?: boolean;
  barcode_detection: boolean;
  blur_detection: boolean;
  flash_mode: 'off' | 'on' | 'auto';
  scan_question_paper: boolean;
  scan_model_answer: boolean;
  page_mode: 'single' | 'double'; // single = 1 page per capture, double = 2 pages (split left/right)
  grading_mode?: 'strict' | 'balanced' | 'conceptual' | 'lenient';
  pilot_review_first?: boolean;
  feedback_enabled?: boolean;
  annotations_enabled?: boolean;
}

export interface ScanSession {
  session_id: string;
  session_name: string;
  batch_id: string;
  batch_name: string;
  subject_id?: string | null;
  total_marks?: number | null;
  exam_date?: string | null;
  org_id?: string;
  user_id?: string;
  exam_id?: string;
  parent_exam_id?: string;
  created_at: string;
  status: 'scanning' | 'ready' | 'uploading' | 'syncing' | 'grading' | 'graded' | 'uploaded' | 'completed' | 'failed' | 'sync_failed';
  upload_progress: number;
  last_sync_error?: string | null;
  grading_job_id?: string | null;
  grading_job_type?: string | null;
  grading_status?: string | null;
  grading_progress?: number | null;
  grading_processed_items?: number | null;
  grading_total_items?: number | null;
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
