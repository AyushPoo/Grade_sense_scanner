export type ReviewDensity = 'compact' | 'comfortable' | 'large';

export interface ReviewDensityOption {
  value: ReviewDensity;
  label: string;
  accessibilityLabel: string;
}

export interface ReviewDensityConfig {
  sectionPaddingHorizontal: number;
  sectionPaddingVertical: number;
  contentPadding: number;
  contentGap: number;
  chipMinWidth: number;
  chipPaddingHorizontal: number;
  chipPaddingVertical: number;
  chipGap: number;
  labelFontSize: number;
  labelLetterSpacing: number;
  questionNumberFontSize: number;
  questionMarksFontSize: number;
  titleFontSize: number;
  bodyFontSize: number;
  bodyLineHeight: number;
  feedbackTitleFontSize: number;
  feedbackTextFontSize: number;
  feedbackLineHeight: number;
  scoreValueFontSize: number;
  scoreMaxFontSize: number;
  blockPadding: number;
  blockRadius: number;
  footerPaddingHorizontal: number;
  footerPaddingTop: number;
  footerPaddingBottomAndroid: number;
  footerPaddingBottomIos: number;
  footerGap: number;
  footerTitleFontSize: number;
  footerLabelFontSize: number;
  stepperButtonSize: number;
  stepperIconSize: number;
  stepperValueFontSize: number;
  stepperValueWidth: number;
  noteMinHeight: number;
  noteFontSize: number;
  noteLineHeight: number;
  micButtonSize: number;
  micIconSize: number;
  savePaddingVertical: number;
  saveFontSize: number;
  saveIconSize: number;
}

export const DEFAULT_REVIEW_DENSITY: ReviewDensity = 'compact';

export const REVIEW_DENSITY_OPTIONS: ReviewDensityOption[] = [
  {
    value: 'compact',
    label: 'A-',
    accessibilityLabel: 'Compact review density',
  },
  {
    value: 'comfortable',
    label: 'A',
    accessibilityLabel: 'Comfortable review density',
  },
  {
    value: 'large',
    label: 'A+',
    accessibilityLabel: 'Large review density',
  },
];

export const REVIEW_DENSITY_CONFIG: Record<ReviewDensity, ReviewDensityConfig> = {
  compact: {
    sectionPaddingHorizontal: 10,
    sectionPaddingVertical: 8,
    contentPadding: 9,
    contentGap: 8,
    chipMinWidth: 76,
    chipPaddingHorizontal: 9,
    chipPaddingVertical: 7,
    chipGap: 7,
    labelFontSize: 9,
    labelLetterSpacing: 0.55,
    questionNumberFontSize: 12,
    questionMarksFontSize: 10,
    titleFontSize: 16,
    bodyFontSize: 12,
    bodyLineHeight: 17,
    feedbackTitleFontSize: 11,
    feedbackTextFontSize: 11,
    feedbackLineHeight: 16,
    scoreValueFontSize: 15,
    scoreMaxFontSize: 10,
    blockPadding: 9,
    blockRadius: 11,
    footerPaddingHorizontal: 10,
    footerPaddingTop: 7,
    footerPaddingBottomAndroid: 7,
    footerPaddingBottomIos: 12,
    footerGap: 6,
    footerTitleFontSize: 12,
    footerLabelFontSize: 10,
    stepperButtonSize: 28,
    stepperIconSize: 18,
    stepperValueFontSize: 12,
    stepperValueWidth: 40,
    noteMinHeight: 34,
    noteFontSize: 11,
    noteLineHeight: 15,
    micButtonSize: 34,
    micIconSize: 20,
    savePaddingVertical: 9,
    saveFontSize: 11,
    saveIconSize: 20,
  },
  comfortable: {
    sectionPaddingHorizontal: 14,
    sectionPaddingVertical: 10,
    contentPadding: 12,
    contentGap: 10,
    chipMinWidth: 88,
    chipPaddingHorizontal: 11,
    chipPaddingVertical: 9,
    chipGap: 10,
    labelFontSize: 10,
    labelLetterSpacing: 0.7,
    questionNumberFontSize: 13,
    questionMarksFontSize: 11,
    titleFontSize: 18,
    bodyFontSize: 13,
    bodyLineHeight: 19,
    feedbackTitleFontSize: 12,
    feedbackTextFontSize: 12,
    feedbackLineHeight: 18,
    scoreValueFontSize: 17,
    scoreMaxFontSize: 11,
    blockPadding: 11,
    blockRadius: 13,
    footerPaddingHorizontal: 12,
    footerPaddingTop: 8,
    footerPaddingBottomAndroid: 8,
    footerPaddingBottomIos: 14,
    footerGap: 8,
    footerTitleFontSize: 13,
    footerLabelFontSize: 11,
    stepperButtonSize: 30,
    stepperIconSize: 20,
    stepperValueFontSize: 13,
    stepperValueWidth: 46,
    noteMinHeight: 38,
    noteFontSize: 12,
    noteLineHeight: 17,
    micButtonSize: 38,
    micIconSize: 22,
    savePaddingVertical: 10,
    saveFontSize: 12,
    saveIconSize: 22,
  },
  large: {
    sectionPaddingHorizontal: 15,
    sectionPaddingVertical: 11,
    contentPadding: 13,
    contentGap: 11,
    chipMinWidth: 96,
    chipPaddingHorizontal: 12,
    chipPaddingVertical: 10,
    chipGap: 10,
    labelFontSize: 10,
    labelLetterSpacing: 0.7,
    questionNumberFontSize: 14,
    questionMarksFontSize: 12,
    titleFontSize: 19,
    bodyFontSize: 14,
    bodyLineHeight: 21,
    feedbackTitleFontSize: 13,
    feedbackTextFontSize: 13,
    feedbackLineHeight: 20,
    scoreValueFontSize: 18,
    scoreMaxFontSize: 12,
    blockPadding: 12,
    blockRadius: 13,
    footerPaddingHorizontal: 13,
    footerPaddingTop: 9,
    footerPaddingBottomAndroid: 9,
    footerPaddingBottomIos: 15,
    footerGap: 9,
    footerTitleFontSize: 14,
    footerLabelFontSize: 12,
    stepperButtonSize: 32,
    stepperIconSize: 21,
    stepperValueFontSize: 14,
    stepperValueWidth: 50,
    noteMinHeight: 42,
    noteFontSize: 13,
    noteLineHeight: 18,
    micButtonSize: 42,
    micIconSize: 23,
    savePaddingVertical: 11,
    saveFontSize: 13,
    saveIconSize: 23,
  },
};

export function getReviewDensityConfig(density: ReviewDensity): ReviewDensityConfig {
  return REVIEW_DENSITY_CONFIG[density] || REVIEW_DENSITY_CONFIG[DEFAULT_REVIEW_DENSITY];
}

export function isReviewDensity(value: unknown): value is ReviewDensity {
  return value === 'compact' || value === 'comfortable' || value === 'large';
}
