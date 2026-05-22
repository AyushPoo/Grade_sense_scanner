import { CVProcessingResult } from '../utils/cvProcessor';
import { CaptureState } from '../types';

interface UseCVAutoCaptureProps {
  enabled: boolean;
  cvResult: CVProcessingResult | null;
  cooldownInactive: boolean;
  workflowStateActive: boolean;
}

export function useCVAutoCapture({
  enabled,
  cvResult,
  cooldownInactive,
  workflowStateActive,
}: UseCVAutoCaptureProps) {
  const isDocumentDetected = cvResult ? cvResult.isDocumentDetected : false;
  const isStable = cvResult ? cvResult.isStable : true;
  const isSharp = cvResult ? cvResult.sharpnessScore >= 100 : true;
  const motionLevel = cvResult ? cvResult.motionLevel : 0;
  const stabilityProgress = cvResult ? (cvResult.isStable ? 1 : 0) : 1;

  const captureState: CaptureState = {
    isStable,
    isDocumentDetected,
    isSharp,
    motionLevel,
    stabilityProgress,
  };

  // Conditions for auto-capture:
  // 1. Auto-capture toggled on/enabled
  // 2. Workflow state is SCANNING_ACTIVE (workflowStateActive)
  // 3. Capture cooldown is not active (cooldownInactive)
  // 4. CV Result is present
  // 5. Document is detected in the live frame
  // 6. Frame is stable (no motion / isStable)
  // 7. Frame is sharp (sharpness score > 100)
  const canAutoCapture =
    enabled &&
    workflowStateActive &&
    cooldownInactive &&
    !!cvResult &&
    cvResult.isDocumentDetected &&
    cvResult.isStable &&
    cvResult.sharpnessScore > 100;

  return {
    captureState,
    canAutoCapture,
    stabilityProgress,
  };
}

