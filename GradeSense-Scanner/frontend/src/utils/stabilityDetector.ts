/**
 * src/utils/stabilityDetector.ts
 *
 * Pure utility class for detecting device stability from accelerometer readings.
 * No React dependencies - can be used anywhere.
 *
 * CRITICAL: Uses DELTA between consecutive readings, NOT raw magnitude.
 *
 * WHY DELTA AND NOT RAW MAGNITUDE:
 * expo-sensors on Android returns accelerometer values in g-units.
 * Earth's gravity = ~1.0 g. A phone lying perfectly still reads z≈1.0 always.
 * Raw magnitude of a still phone = sqrt(0² + 0² + 1²) = 1.0 constantly.
 * With threshold=0.5, stable=false FOREVER because 1.0 > 0.5.
 *
 * Delta = change between consecutive readings cancels gravity out:
 *   Still phone:   delta ≈ 0.000–0.015 (only sensor noise)
 *   Hand tremor:   delta ≈ 0.020–0.060
 *   Slow movement: delta ≈ 0.060–0.150
 *   Fast movement: delta ≈ 0.150+
 *
 * Recommended threshold: 0.04 g-units (comfortable margin above noise floor)
 *
 * Usage:
 *   const detector = new StabilityDetector(5, 0.04);
 *   const result = detector.addReading(accelerometerData);
 *   if (result.isStable) { ... }
 */

export interface AccelerometerReading {
    x: number;
    y: number;
    z: number;
    timestamp: number;
}

export interface StabilityResult {
    /** Raw magnitude of acceleration (includes gravity ~1.0 — for display only, NOT used for stability) */
    magnitude: number;
    /** Delta magnitude vs previous reading — this is what determines stability */
    deltaMagnitude: number;
    /** True when buffer is full AND all deltas are below threshold */
    isStable: boolean;
    /** True when buffer has reached required sample count */
    bufferFull: boolean;
    /** Average delta in current buffer (lower = more stable) */
    averageMotion: number;
}

/**
 * Detects device stability using delta-based motion measurement.
 *
 * ALGORITHM:
 * 1. Compute per-axis delta from previous reading (cancels gravity)
 * 2. Compute magnitude of the delta vector
 * 3. Keep rolling buffer of last N delta magnitudes
 * 4. When buffer is full AND all deltas < threshold → device is stable
 *
 * EXAMPLE with threshold=0.04, sampleCount=5:
 *   Reading 1: delta=0.000 (first reading, no prev) → skip, not buffered
 *   Reading 2: delta=0.120 (moving)  → buffer=[0.120], unstable
 *   Reading 3: delta=0.080 (slowing) → buffer=[0.120, 0.080], unstable
 *   Reading 4: delta=0.030 (settling)→ buffer=[0.120, 0.080, 0.030], unstable
 *   Reading 5: delta=0.010 (still)   → buffer=[0.120, 0.080, 0.030, 0.010], unstable
 *   Reading 6: delta=0.008 (still)   → buffer=[0.080, 0.030, 0.010, 0.008], unstable
 *   Reading 7: delta=0.012 (all<0.04)→ buffer=[0.030, 0.010, 0.008, 0.012] → STABLE!
 */
export class StabilityDetector {
    private deltaBuffer: number[] = [];
    private previousReading: AccelerometerReading | null = null;
    private readonly maxBufferSize: number;
    private readonly threshold: number;

    /**
     * @param maxBufferSize - How many consecutive stable delta readings needed (typically 5–8)
     * @param threshold     - Delta magnitude threshold in g-units (recommended: 0.04)
     */
    constructor(maxBufferSize: number, threshold: number) {
        if (maxBufferSize < 1) {
            throw new Error('maxBufferSize must be >= 1');
        }
        if (threshold <= 0) {
            throw new Error('threshold must be > 0');
        }

        this.maxBufferSize = maxBufferSize;
        this.threshold = threshold;

        if (__DEV__) {
            console.log(
                `[StabilityDetector] Initialized: ` +
                `bufferSize=${maxBufferSize}, threshold=${threshold.toFixed(3)} (delta g-units)`,
            );
        }
    }

    /**
     * Add a new accelerometer reading to the detector.
     *
     * Returns:
     * - magnitude:     raw acceleration magnitude (includes gravity, display only)
     * - deltaMagnitude: change from previous reading (used for stability logic)
     * - isStable:      true if all buffered deltas < threshold
     * - bufferFull:    true if buffer has enough samples to make a decision
     * - averageMotion: average delta in buffer (lower = more stable)
     */
    addReading(reading: AccelerometerReading): StabilityResult {
        // Raw magnitude — includes gravity, useful only for display/debugging
        const magnitude = Math.sqrt(
            reading.x * reading.x +
            reading.y * reading.y +
            reading.z * reading.z,
        );

        // First reading: no previous to diff against, skip buffering
        if (!this.previousReading) {
            this.previousReading = reading;
            return {
                magnitude,
                deltaMagnitude: 0,
                isStable: false,
                bufferFull: false,
                averageMotion: 0,
            };
        }

        // Delta: how much did each axis change since last reading?
        // This cancels out gravity (constant in all axes when still)
        const dx = reading.x - this.previousReading.x;
        const dy = reading.y - this.previousReading.y;
        const dz = reading.z - this.previousReading.z;
        const deltaMagnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);

        this.previousReading = reading;

        // Rolling buffer of delta magnitudes
        this.deltaBuffer.push(deltaMagnitude);
        if (this.deltaBuffer.length > this.maxBufferSize) {
            this.deltaBuffer.shift();
        }

        const bufferFull = this.deltaBuffer.length === this.maxBufferSize;
        const isStable = bufferFull && this.deltaBuffer.every(d => d < this.threshold);
        const averageMotion = this.getAverageMotion();

        if (__DEV__) {
            const bufStr = this.deltaBuffer.map(d => d.toFixed(3)).join(', ');
            console.log(
                `[Motion] raw=${magnitude.toFixed(3)} ` +
                `delta=${deltaMagnitude.toFixed(3)} ` +
                `buf=[${bufStr}] ` +
                `avg=${averageMotion.toFixed(3)} ` +
                `full=${bufferFull} stable=${isStable}`,
            );
        }

        return {
            magnitude,
            deltaMagnitude,
            isStable,
            bufferFull,
            averageMotion,
        };
    }

    /**
     * Average delta magnitude in the current buffer.
     * Lower = more stable. Useful for live UI feedback.
     */
    getAverageMotion(): number {
        if (this.deltaBuffer.length === 0) return 0;
        return this.deltaBuffer.reduce((a, b) => a + b, 0) / this.deltaBuffer.length;
    }

    /**
     * Maximum delta recorded in the buffer.
     * Useful for debugging peak disturbance.
     */
    getMaxMotion(): number {
        if (this.deltaBuffer.length === 0) return 0;
        return Math.max(...this.deltaBuffer);
    }

    /**
     * Minimum delta recorded in the buffer.
     */
    getMinMotion(): number {
        if (this.deltaBuffer.length === 0) return 0;
        return Math.min(...this.deltaBuffer);
    }

    /**
     * Current number of samples in the buffer (0 to maxBufferSize).
     * Useful for a progress indicator while filling up.
     */
    getBufferSize(): number {
        return this.deltaBuffer.length;
    }

    /**
     * Whether the buffer has reached maximum capacity.
     */
    isBufferFull(): boolean {
        return this.deltaBuffer.length === this.maxBufferSize;
    }

    /**
     * Buffer fill as a 0.0–1.0 fraction.
     */
    getProgress(): number {
        return this.deltaBuffer.length / this.maxBufferSize;
    }

    /**
     * Snapshot of the current delta buffer (for debugging).
     */
    getBuffer(): number[] {
        return [...this.deltaBuffer];
    }

    /**
     * Reset buffer and previous reading.
     * Call after a capture completes, or when pausing.
     */
    reset(): void {
        this.deltaBuffer = [];
        this.previousReading = null;
        if (__DEV__) {
            console.log('[StabilityDetector] Reset');
        }
    }
}