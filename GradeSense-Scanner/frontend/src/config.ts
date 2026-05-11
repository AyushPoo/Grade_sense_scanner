// GradeSense Scanner Configuration
const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!API_BASE_URL) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_BACKEND_URL');
}

export const CONFIG = {
  // API
  API_BASE_URL,

  // Camera
  CAMERA_RESOLUTION: 'high' as const,
  IMAGE_TARGET_WIDTH: 1800,
  IMAGE_TARGET_HEIGHT: 2545,
  IMAGE_COMPRESSION_QUALITY: 0.6,
  MAX_IMAGE_SIZE_KB: 300,

  // Auto-Capture
  STABILITY_THRESHOLD: 0.3,
  STABILITY_DURATION_MS: 600,
  MOTION_THRESHOLD: 2.0,
  COOLDOWN_AFTER_CAPTURE_MS: 1500,

  // Document Detection
  EDGE_DETECTION_CONFIDENCE: 0.7,
  MIN_DOCUMENT_AREA_RATIO: 0.3,
  MAX_DOCUMENT_AREA_RATIO: 0.95,

  // Blur Detection
  BLUR_THRESHOLD: 100,
  BLUR_CHECK_ENABLED: true,

  // Upload
  UPLOAD_CHUNK_SIZE: 5,
  UPLOAD_RETRY_COUNT: 3,
  UPLOAD_RETRY_DELAY_MS: 2000,

  // Barcode
  BARCODE_SCAN_ENABLED: true,
  BARCODE_TYPES: ['qr', 'code128', 'code39'] as const,
};

// Theme colors - Orange and White
export const COLORS = {
  primary: '#FF6B35',
  primaryDark: '#E55A2B',
  primaryLight: '#FF8F66',
  secondary: '#FFFFFF',
  background: '#FFFFFF',
  backgroundDark: '#F5F5F5',
  text: '#1A1A1A',
  textLight: '#666666',
  textMuted: '#999999',
  success: '#4CAF50',
  warning: '#FFC107',
  error: '#F44336',
  border: '#E0E0E0',
  cardBg: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const FONTS = {
  regular: 'System',
  bold: 'System',
};
