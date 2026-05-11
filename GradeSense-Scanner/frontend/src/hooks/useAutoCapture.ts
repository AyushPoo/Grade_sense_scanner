import { useState, useEffect, useRef, useCallback } from 'react';
import { Accelerometer } from 'expo-sensors';
import { CONFIG } from '../config';
import { CaptureState } from '../types';

interface UseAutoCaptureProps {
  enabled: boolean;
  onCapture: () => void;
  documentDetected: boolean;
}

export const useAutoCapture = ({ enabled, onCapture, documentDetected }: UseAutoCaptureProps) => {
  const [captureState, setCaptureState] = useState<CaptureState>({
    isStable: false,
    isDocumentDetected: documentDetected,
    isSharp: true,
    motionLevel: 0,
    stabilityProgress: 0,
  });

  const motionHistoryRef = useRef<number[]>([]);
  const stableStartTimeRef = useRef<number | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const subscriptionRef = useRef<any>(null);

  const calculateVariance = useCallback((values: number[]) => {
    if (values.length === 0) return 0;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  }, []);

  useEffect(() => {
    setCaptureState(prev => ({ ...prev, isDocumentDetected: documentDetected }));
  }, [documentDetected]);

  useEffect(() => {
    if (!enabled) {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      return;
    }

    Accelerometer.setUpdateInterval(100);

    subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const motion = Math.sqrt(x * x + y * y + z * z);
      
      motionHistoryRef.current.push(motion);
      if (motionHistoryRef.current.length > 10) {
        motionHistoryRef.current.shift();
      }

      const variance = calculateVariance(motionHistoryRef.current);
      const isCurrentlyStable = variance < CONFIG.STABILITY_THRESHOLD;
      const now = Date.now();

      if (isCurrentlyStable) {
        if (!stableStartTimeRef.current) {
          stableStartTimeRef.current = now;
        }

        const stableDuration = now - stableStartTimeRef.current;
        const stabilityProgress = Math.min(stableDuration / CONFIG.STABILITY_DURATION_MS, 1);
        const timeSinceLastCapture = now - lastCaptureTimeRef.current;

        setCaptureState(prev => ({
          ...prev,
          isStable: true,
          motionLevel: variance,
          stabilityProgress,
        }));

        // Auto-capture conditions
        if (
          stableDuration >= CONFIG.STABILITY_DURATION_MS &&
          timeSinceLastCapture >= CONFIG.COOLDOWN_AFTER_CAPTURE_MS &&
          documentDetected
        ) {
          lastCaptureTimeRef.current = now;
          stableStartTimeRef.current = null;
          onCapture();
          setCaptureState(prev => ({ ...prev, stabilityProgress: 0 }));
        }
      } else {
        stableStartTimeRef.current = null;
        setCaptureState(prev => ({
          ...prev,
          isStable: false,
          motionLevel: variance,
          stabilityProgress: 0,
        }));
      }
    });

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [enabled, documentDetected, onCapture, calculateVariance]);

  const resetCooldown = useCallback(() => {
    lastCaptureTimeRef.current = Date.now();
    stableStartTimeRef.current = null;
    setCaptureState(prev => ({ ...prev, stabilityProgress: 0 }));
  }, []);

  return { captureState, resetCooldown };
};
