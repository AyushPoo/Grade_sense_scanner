// GradeSense Scanner Configuration
const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!API_BASE_URL) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_BACKEND_URL');
}

export const CONFIG = {
  // API
  API_BASE_URL,

  // Camera
  CAMERA_RESOLUTION: 'medium' as const,
  IMAGE_TARGET_WIDTH: 1200,
  IMAGE_TARGET_HEIGHT: 1697,
  IMAGE_COMPRESSION_QUALITY: 0.5,
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

// ─── Design System ────────────────────────────────────────────────────
// Premium EdTech palette inspired by Toddle, Turnitin, Magic School AI
export const COLORS = {
  // Brand
  primary: '#FF6B35',
  primaryDark: '#E04E1A',
  primaryLight: '#FF9166',
  primaryXLight: '#FFF0EB',

  // Backgrounds (light, airy)
  background: '#FFFFFF',
  backgroundDark: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceElevated: '#F0F2F5',

  // Text hierarchy
  text: '#111827',          // near black
  textLight: '#4B5563',     // secondary text
  textMuted: '#9CA3AF',     // disabled/placeholder
  textInverse: '#FFFFFF',

  // Semantic
  success: '#10B981',       // emerald
  successLight: '#D1FAE5',
  warning: '#F59E0B',       // amber
  warningLight: '#FEF3C7',
  error: '#EF4444',         // red
  errorLight: '#FEE2E2',
  info: '#3B82F6',          // blue
  infoLight: '#DBEAFE',

  // Deprecated aliases (backward compat)
  danger: '#EF4444',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  cardBg: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#111827',
  overlay: 'rgba(0, 0, 0, 0.45)',
  overlayLight: 'rgba(0, 0, 0, 0.2)',
};

// Typography scale
export const TYPOGRAPHY = {
  displayLg: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  displayMd: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  headingLg: { fontSize: 22, fontWeight: '700' as const },
  headingMd: { fontSize: 18, fontWeight: '700' as const },
  headingSm: { fontSize: 16, fontWeight: '600' as const },
  bodyLg: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyMd: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  bodySm: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  labelMd: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.5 },
  labelSm: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.8 },
  caption: { fontSize: 11, fontWeight: '400' as const },
};

// Spacing
export const SPACING = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

// Border radius
export const RADIUS = {
  sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, full: 9999,
};

export const FONTS = {
  regular: 'System',
  bold: 'System',
};
