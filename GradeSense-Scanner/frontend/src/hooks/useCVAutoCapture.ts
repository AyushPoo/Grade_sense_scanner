import { useState, useEffect, useRef } from 'react';
import { CVProcessingResult } from '../utils/cvProcessor';
import { CaptureState } from '../types';

interface UseCVAutoCaptureProps {
  enabled: boolean;
  onCapture: () => void;
  cvResult: CVProcessingResult | null;
  cooldownMs?: number;
}

export function useCVAutoCapture({
  enabled,
  onCapture,
  cvResult,
  cooldownMs = 2000,
}: UseCVAutoCaptureProps) {
  const [lastCaptureTime, setLastCaptureTime] = useState(0);
  const captureTimeoutRef = useRef<any>(null);
  const isCapturingRef = useRef(false);

  const captureState: CaptureState = {
    isStable: cvResult ? cvResult.isStable : true,
    isDocumentDetected: cvResult ? cvResult.isDocumentDetected : false,
    isSharp: cvResult ? cvResult.sharpnessScore >= 100 : true,
    motionLevel: cvResult ? cvResult.motionLevel : 0,
    stabilityProgress: cvResult ? (cvResult.isStable ? 1 : 0) : 1,
  };

  useEffect(() => {
    if (!enabled || !cvResult) {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
      return;
    }

    const now = Date.now();
    const inCooldown = now - lastCaptureTime < cooldownMs;

    // Conditions for auto-capture:
    // 1. Not in cooldown
    // 2. Not currently capturing
    // 3. Document is detected
    // 4. Frame is stable (no motion)
    // 5. Sharpness is acceptable (assuming cvProcessor returns a decent score, e.g. > 100)

    const canCapture =
      !inCooldown &&
      !isCapturingRef.current &&
      cvResult.isDocumentDetected &&
      cvResult.isStable &&
      cvResult.sharpnessScore > 100; // threshold for sharpness

    if (canCapture) {
      // Debounce the capture by a small amount to ensure it stays stable
      if (!captureTimeoutRef.current) {
        captureTimeoutRef.current = setTimeout(() => {
          isCapturingRef.current = true;
          onCapture();
          setLastCaptureTime(Date.now());
          
          // Reset capturing ref after a short delay
          setTimeout(() => {
            isCapturingRef.current = false;
          }, cooldownMs);

          captureTimeoutRef.current = null;
        }, 500); // 500ms stability requirement
      }
    } else {
      // If conditions fail, clear the timeout
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current);
        captureTimeoutRef.current = null;
      }
    }

    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
    };
  }, [enabled, cvResult, lastCaptureTime, onCapture, cooldownMs]);

  const resetCooldown = () => {
    setLastCaptureTime(0);
    isCapturingRef.current = false;
  };

  return { captureState, resetCooldown };
}
