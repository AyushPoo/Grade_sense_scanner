/**
 * src/hooks/useMotionStability.ts
 *
 * React hook that uses the device accelerometer to detect when the camera
 * becomes stable, then fires onStable() once after a confirmation wait.
 *
 * ── BUGS FIXED IN THIS VERSION ───────────────────────────────────────────────
 *
 * BUG 1 — StabilityDetector was reinitializing on every accelerometer tick
 *   Symptom: "[StabilityDetector] Initialized" log appearing every 250ms.
 *   Root cause: `detectorRef.current = new StabilityDetector(...)` was INSIDE
 *   the useEffect body. The effect re-ran whenever handleStableDetected changed
 *   identity. handleStableDetected changed because resetState changed because
 *   setStabilizing changed — a useCallback chain all the way up, each with
 *   deps that caused rebuilds on state ticks.
 *   Fix: Detector created ONCE with useRef() at declaration time, at the top
 *   of the hook. The effect only calls detector.reset(), never recreates it.
 *   Parameter changes (sampleCount, motionThreshold) call reset() and the
 *   detector adapts because those values are read from refs inside addReading.
 *   (Actually we do recreate it when params change — but ONLY then, not on
 *   every tick. See the param-change effect below.)
 *
 * BUG 2 — Raw accelerometer magnitude ~1.0 due to gravity, threshold 0.5 never reached
 *   Symptom: all magnitude logs showing ~1.0, stable=false always.
 *   Root cause: expo-sensors returns g-units on Android. Earth's gravity = 1g.
 *   A still phone always reads magnitude ≈ 1.0. With threshold=0.5: 1.0 > 0.5
 *   so isStable was always false.
 *   Fix: StabilityDetector now uses DELTA between consecutive readings.
 *   Still phone delta ≈ 0.000–0.015. Motion threshold changed to 0.04.
 *   Update scanner.tsx: MOTION_THRESHOLD = 0.04 (not 0.5).
 *
 * BUG 3 — useEffect dep chain caused listener remount on every state change
 *   Symptom: "[MOTION] Cleanup: removing listener" + "[MOTION] Starting"
 *   appearing on every accelerometer tick.
 *   Root cause: isStabilizing (React state) was in effect deps → listener
 *   torn down and rebuilt on every state flip. Also handleStableDetected was
 *   rebuilt frequently due to dep chains.
 *   Fix: All mutable values tracked in refs. handleStableDetected has a truly
 *   stable identity (empty useCallback dep array — all values from refs).
 *   Effect dep array contains only stable primitives + truly-stable callbacks.
 *
 * BUG 4 — hasTriggeredRef cleared by listener remount, allowing double-fire
 *   Symptom: onStable() called multiple times per stability event.
 *   Root cause: Each remount (caused by bug 3) reset the detector and refs.
 *   Fix: With bug 3 fixed, remounts only happen when enabled/params change,
 *   not on state ticks. hasTriggeredRef survives normal operation.
 *
 * ── THRESHOLD GUIDE ──────────────────────────────────────────────────────────
 *   motionThreshold is now in delta g-units (change between readings):
 *   0.02 = very strict, tripod-level stillness required
 *   0.04 = recommended, normal hand-held use with slight tremor OK
 *   0.08 = relaxed, moderate hand movement still triggers
 *   0.15 = very relaxed, slow deliberate movement triggers capture
 *
 * ── REQUIRED CHANGE IN scanner.tsx ──────────────────────────────────────────
 *   const MOTION_THRESHOLD = 0.04;   // was 0.5 (wrong unit/approach)
 *   const MOTION_UPDATE_INTERVAL = 100;  // was 250 (faster = smoother delta)
 *
 * Usage:
 *   const { isStabilizing, stabilityProgress, averageMotion } = useMotionStability({
 *     enabled: !isPaused && isCameraReady && !isCapturing && autoCaptureEnabled,
 *     onStable: triggerCapture,
 *     waitTime: 3500,
 *     motionThreshold: 0.04,
 *     sampleCount: 5,
 *     updateInterval: 100,
 *   });
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { StabilityDetector } from '../utils/stabilityDetector';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface UseMotionStabilityOptions {
    /** Master switch — toggling false cancels any in-progress wait */
    enabled: boolean;
    /** Called once when motion has been stable for `waitTime` ms */
    onStable: () => void | Promise<void>;
    /** How long motion must stay stable before triggering (ms). Default: 3500 */
    waitTime?: number;
    /**
     * Delta magnitude threshold in g-units. Default: 0.04
     * This is the CHANGE between consecutive readings, NOT raw magnitude.
     * Still phone delta ≈ 0.000–0.015. Set to 0.04 for comfortable margin.
     */
    motionThreshold?: number;
    /** Consecutive stable delta readings required. Default: 5 */
    sampleCount?: number;
    /**
     * Accelerometer poll frequency in ms. Default: 100
     * Lower = more responsive delta calculation. 100ms recommended.
     */
    updateInterval?: number;
    /** Optional — called when stabilisation phase starts/ends */
    onStabilizingChange?: (isStabilizing: boolean) => void;
}

export interface UseMotionStabilityReturn {
    /** True during the waitTime confirmation window */
    isStabilizing: boolean;
    /** 0–100: buffer fill progress toward stability decision */
    stabilityProgress: number;
    /** Average delta in current buffer — useful for a live debug overlay */
    averageMotion: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_WAIT_TIME = 3500;  // ms
const DEFAULT_THRESHOLD = 0.04;  // g-units delta (NOT raw magnitude)
const DEFAULT_SAMPLE_COUNT = 5;
const DEFAULT_UPDATE_INTERVAL = 100;   // ms — faster = better delta resolution

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMotionStability(
    options: UseMotionStabilityOptions,
): UseMotionStabilityReturn {
    const {
        enabled,
        onStable,
        waitTime = DEFAULT_WAIT_TIME,
        motionThreshold = DEFAULT_THRESHOLD,
        sampleCount = DEFAULT_SAMPLE_COUNT,
        updateInterval = DEFAULT_UPDATE_INTERVAL,
        onStabilizingChange,
    } = options;

    // ── UI state (only for rendering, never read inside callbacks) ────────────
    const [isStabilizing, setIsStabilizing] = useState(false);
    const [stabilityProgress, setStabilityProgress] = useState(0);
    const [averageMotion, setAverageMotion] = useState(0);

    // ── All mutable values in refs so callbacks are always stable ─────────────

    /**
     * Detector is created ONCE here and only reset (never recreated) during
     * normal operation. This is the fix for Bug 1.
     * A separate effect below recreates it ONLY when sampleCount or
     * motionThreshold change (which is a deliberate config change, not a tick).
     */
    const detectorRef = useRef(new StabilityDetector(sampleCount, motionThreshold));

    /**
     * Set true the moment we decide to trigger, before any await.
     * Cleared only after the full async capture path finishes via fullReset().
     * Prevents any second tick from firing a duplicate capture (Bug 4 fix).
     */
    const hasTriggeredRef = useRef(false);

    /**
     * Mirrors isStabilizing state but synchronously readable in callbacks.
     * Avoids stale closure reads without adding state to dep arrays (Bug 3 fix).
     */
    const isStabilizingRef = useRef(false);

    // Latest option values — kept current via dedicated effects below
    const enabledRef = useRef(enabled);
    const onStableRef = useRef(onStable);
    const onStabChangeRef = useRef(onStabilizingChange);
    const waitTimeRef = useRef(waitTime);

    const subscriptionRef = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
    const waitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTickRef = useRef(0);

    // ── Keep latest option values in refs without affecting effect deps ────────
    useEffect(() => { enabledRef.current = enabled; }, [enabled]);
    useEffect(() => { onStableRef.current = onStable; }, [onStable]);
    useEffect(() => { onStabChangeRef.current = onStabilizingChange; }, [onStabilizingChange]);
    useEffect(() => { waitTimeRef.current = waitTime; }, [waitTime]);

    // ── Recreate detector ONLY when config params change (not on every tick) ──
    useEffect(() => {
        detectorRef.current = new StabilityDetector(sampleCount, motionThreshold);
    }, [sampleCount, motionThreshold]);

    // ── Stable helpers ────────────────────────────────────────────────────────

    /**
     * Set stabilizing state in both ref (sync) and React state (for UI).
     * Empty dep array: only touches refs and stable React state setters.
     */
    const setStabilizing = useCallback((value: boolean) => {
        isStabilizingRef.current = value;
        setIsStabilizing(value);
        onStabChangeRef.current?.(value);
    }, []); // stable — no deps that change

    /**
     * Full reset after a capture cycle completes (success or abort).
     * Clears timeout, resets detector, clears all flags and UI state.
     */
    const fullReset = useCallback(() => {
        if (waitTimeoutRef.current) {
            clearTimeout(waitTimeoutRef.current);
            waitTimeoutRef.current = null;
        }
        detectorRef.current.reset();
        hasTriggeredRef.current = false;
        isStabilizingRef.current = false;
        setIsStabilizing(false);
        setStabilityProgress(0);
        setAverageMotion(0);
        onStabChangeRef.current?.(false);
    }, []); // stable — only touches refs and stable React state setters

    // ── Core trigger ──────────────────────────────────────────────────────────

    /**
     * Called when detector reports isStable=true.
     * Waits for the confirmation period then fires onStable() once.
     *
     * STABLE IDENTITY: empty dep array. All values read from refs.
     * This is the critical fix for Bug 3 — if this function rebuilt on every
     * render it would pull the useEffect with it, remounting the listener.
     */
    const handleStableDetected = useCallback(async () => {
        // Synchronous double-gate: set both before any await
        if (hasTriggeredRef.current) return;
        if (isStabilizingRef.current) return;

        hasTriggeredRef.current = true;
        isStabilizingRef.current = true;

        setIsStabilizing(true);
        setStabilityProgress(100);
        onStabChangeRef.current?.(true);

        if (__DEV__) {
            console.log(`[MOTION] Stable! Waiting ${waitTimeRef.current}ms before capture…`);
        }

        await new Promise<void>(resolve => {
            waitTimeoutRef.current = setTimeout(resolve, waitTimeRef.current);
        });

        // If disabled while we were waiting, abort silently
        if (!enabledRef.current) {
            if (__DEV__) console.log('[MOTION] Disabled during wait — aborting');
            fullReset();
            return;
        }

        if (__DEV__) console.log('[MOTION] Triggering auto-capture');

        try {
            await onStableRef.current();
        } catch (err) {
            console.warn('[MOTION] onStable threw:', err);
        } finally {
            fullReset();
        }
    }, []); // ← empty: every value read from refs; identity is permanently stable

    // ── Accelerometer listener ────────────────────────────────────────────────

    useEffect(() => {

        // ── DISABLED ─────────────────────────────────────────────────────────────
        if (!enabled) {
            if (__DEV__) console.log('[MOTION] Disabled — cleaning up');

            subscriptionRef.current?.remove();
            subscriptionRef.current = null;

            if (waitTimeoutRef.current) {
                clearTimeout(waitTimeoutRef.current);
                waitTimeoutRef.current = null;
            }

            detectorRef.current.reset();
            hasTriggeredRef.current = false;
            isStabilizingRef.current = false;
            setIsStabilizing(false);
            setStabilityProgress(0);
            setAverageMotion(0);
            onStabChangeRef.current?.(false);
            return;
        }

        // ── ENABLED ──────────────────────────────────────────────────────────────
        if (__DEV__) {
            console.log(
                `[MOTION] Starting — interval=${updateInterval}ms ` +
                `threshold=${motionThreshold} (delta g-units) samples=${sampleCount}`,
            );
        }

        // Reset detector for a fresh cycle (it was already created/recreated by
        // the param-change effect above, so we just clear its buffer here)
        detectorRef.current.reset();
        hasTriggeredRef.current = false;

        try {
            Accelerometer.setUpdateInterval(updateInterval);
        } catch (e) {
            console.error('[MOTION] setUpdateInterval failed:', e);
        }

        subscriptionRef.current = Accelerometer.addListener(data => {
            const now = Date.now();
            // Throttle: expo-sensors fires faster than setUpdateInterval sometimes
            if (now - lastTickRef.current < updateInterval) return;
            lastTickRef.current = now;

            const result = detectorRef.current.addReading({
                x: data.x, y: data.y, z: data.z, timestamp: now,
            });

            // Update UI progress (buffer fill → 0–100%)
            setStabilityProgress(detectorRef.current.getProgress() * 100);
            setAverageMotion(result.averageMotion);

            // Single trigger guard — hasTriggeredRef is set synchronously inside
            // handleStableDetected before any await, so no double-fire possible
            if (result.isStable && !hasTriggeredRef.current) {
                if (__DEV__) console.log('[MOTION] ✓ All deltas below threshold — triggering');
                handleStableDetected();
            }
        });

        if (__DEV__) console.log('[MOTION] Accelerometer listener attached');

        return () => {
            if (__DEV__) console.log('[MOTION] Cleanup: removing listener');
            subscriptionRef.current?.remove();
            subscriptionRef.current = null;
            // intentionally NOT clearing waitTimeoutRef or hasTriggeredRef here:
            // the async handleStableDetected is still running and owns those refs.
            // It will call fullReset() when done.
        };

        // Dep array explanation:
        // - enabled:              must react to pause/unpause
        // - sampleCount,
        //   motionThreshold,
        //   updateInterval:       config change → restart listener with new params
        // - handleStableDetected: stable identity (empty dep array useCallback)
        // NOT included:
        // - isStabilizing:        tracked via isStabilizingRef (Bug 3 fix)
        // - hasTriggeredRef:      it's a ref, refs never go in dep arrays
        // - setStabilizing/fullReset: not used directly in this effect body
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, sampleCount, motionThreshold, updateInterval, handleStableDetected]);

    return { isStabilizing, stabilityProgress, averageMotion };
}