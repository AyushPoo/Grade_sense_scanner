export type ReviewGradingMode = 'balanced' | 'strict' | 'lenient' | 'conceptual';
export type ReviewDifficulty = 'medium' | 'easy' | 'hard';

export interface ReviewSettings {
  gradingMode: ReviewGradingMode;
  feedbackEnabled: boolean;
  annotationsEnabled: boolean;
  difficulty: ReviewDifficulty;
  customInstructions: string;
}

type RawReviewSettings = Partial<ReviewSettings> & {
  grading_mode?: string | null;
  gradingMode?: string | null;
  feedback_enabled?: boolean | null;
  feedbackEnabled?: boolean | null;
  annotations_enabled?: boolean | null;
  annotationsEnabled?: boolean | null;
  difficulty?: string | null;
  custom_instructions?: string | null;
  customInstructions?: string | null;
};

export const REVIEW_GRADING_MODES: {
  value: ReviewGradingMode;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Default scoring balance.',
    icon: 'scale-outline',
  },
  {
    value: 'strict',
    label: 'Strict',
    description: 'Closer rubric matching.',
    icon: 'shield-half-outline',
  },
  {
    value: 'lenient',
    label: 'Lenient',
    description: 'More generous scoring.',
    icon: 'heart-outline',
  },
  {
    value: 'conceptual',
    label: 'Conceptual',
    description: 'Prioritize key ideas.',
    icon: 'bulb-outline',
  },
];

export const REVIEW_DIFFICULTIES: {
  value: ReviewDifficulty;
  label: string;
}[] = [
  { value: 'medium', label: 'Medium' },
  { value: 'easy', label: 'Easy' },
  { value: 'hard', label: 'Hard' },
];

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  gradingMode: 'balanced',
  feedbackEnabled: true,
  annotationsEnabled: false,
  difficulty: 'medium',
  customInstructions: '',
};

export function normalizeReviewSettings(settings?: RawReviewSettings | null): ReviewSettings {
  const gradingMode = normalizeGradingMode(settings?.gradingMode || settings?.grading_mode);
  const difficulty = normalizeDifficulty(settings?.difficulty);

  return {
    ...DEFAULT_REVIEW_SETTINGS,
    gradingMode,
    feedbackEnabled: settings?.feedbackEnabled ?? settings?.feedback_enabled ?? DEFAULT_REVIEW_SETTINGS.feedbackEnabled,
    annotationsEnabled: settings?.annotationsEnabled ?? settings?.annotations_enabled ?? DEFAULT_REVIEW_SETTINGS.annotationsEnabled,
    difficulty,
    customInstructions: settings?.customInstructions || settings?.custom_instructions || '',
  };
}

export function buildReviewSettingsPayload(settings: ReviewSettings) {
  return {
    gradingMode: settings.gradingMode,
    feedbackEnabled: settings.feedbackEnabled,
    annotationsEnabled: settings.annotationsEnabled,
    difficulty: settings.difficulty,
    customInstructions: settings.customInstructions.trim(),
  };
}

function normalizeGradingMode(value?: string | null): ReviewGradingMode {
  return REVIEW_GRADING_MODES.some(mode => mode.value === value)
    ? value as ReviewGradingMode
    : DEFAULT_REVIEW_SETTINGS.gradingMode;
}

function normalizeDifficulty(value?: string | null): ReviewDifficulty {
  return REVIEW_DIFFICULTIES.some(option => option.value === value)
    ? value as ReviewDifficulty
    : DEFAULT_REVIEW_SETTINGS.difficulty;
}
