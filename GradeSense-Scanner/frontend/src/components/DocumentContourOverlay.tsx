/**
 * DocumentContourOverlay
 *
 * Renders an Adobe Scan-style document outline above the live camera feed.
 *
 * Design choices:
 *  - React.memo: only re-renders when CV props change (every ~2 s), not per frame
 *  - SVG Polygon: document outline, color-coded by capture readiness
 *  - SVG Line pairs: corner bracket anchors at each corner (L-shaped)
 *  - pointerEvents="none" on outer View: never blocks touch
 *  - Coordinate system: quad coordinates are in the downscaled CV frame
 *    (480 px wide). The SVG viewBox + preserveAspectRatio handles scaling
 *    to the actual container size automatically — no manual math needed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Animated } from 'react-native';
import Svg, { Polygon, Line } from 'react-native-svg';
import { Quadrilateral, Point } from '../utils/cvProcessor';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DocumentContourOverlayProps {
  quadrilateral: Quadrilateral | null;
  dimensions: { width: number; height: number } | undefined;
  /** 0-100 capture readiness score from CV pipeline */
  captureReadiness: number;
  isStable: boolean;
  isPaused: boolean;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function getStrokeColor(readiness: number): string {
  if (readiness >= 80) return '#4CAF50'; // green  — ready to capture
  if (readiness >= 50) return '#FFC107'; // amber  — document found, not stable
  return 'rgba(255,255,255,0.55)';        // white  — partial detection
}

function getFillColor(readiness: number): string {
  if (readiness >= 80) return 'rgba(76,175,80,0.12)';
  if (readiness >= 50) return 'rgba(255,193,7,0.08)';
  return 'rgba(255,255,255,0.04)';
}

// ─── Component ────────────────────────────────────────────────────────────────

const OVERLAY_GRACE_MS = 1200;

export const DocumentContourOverlay = React.memo<DocumentContourOverlayProps>(
  ({ quadrilateral, dimensions, captureReadiness, isPaused }) => {
    const previousCornersRef = useRef<Quadrilateral | null>(null);
    const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    const [displayQuad, setDisplayQuad] = useState<Quadrilateral | null>(null);
    const [displayDimensions, setDisplayDimensions] = useState<{ width: number; height: number } | null>(null);
    const [displayReadiness, setDisplayReadiness] = useState<number>(0);

    // ── RENDER INSTRUMENTATION (Phase 2) ──────────────────────────────────────
    const renderCountRef = useRef(0);
    renderCountRef.current++;
    if (__DEV__) {
      console.log(`[RENDER] DocumentContourOverlay: count=${renderCountRef.current}, detection=${quadrilateral ? 'YES' : 'NO'}`);
    }
    // ─────────────────────────────────────────────────────────────────────────────

    useEffect(() => {
      if (isPaused) {
        setDisplayQuad(null);
        previousCornersRef.current = null;
        return;
      }

      if (quadrilateral && dimensions) {
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
          graceTimerRef.current = null;
        }

        let newQuad = quadrilateral;
        
        // Coordinate Interpolation (Smoothing)
        if (previousCornersRef.current) {
          const old = previousCornersRef.current;
          const smoothPoint = (o: Point, n: Point): Point => ({
            x: o.x * 0.7 + n.x * 0.3,
            y: o.y * 0.7 + n.y * 0.3
          });
          newQuad = {
            topLeft: smoothPoint(old.topLeft, quadrilateral.topLeft),
            topRight: smoothPoint(old.topRight, quadrilateral.topRight),
            bottomRight: smoothPoint(old.bottomRight, quadrilateral.bottomRight),
            bottomLeft: smoothPoint(old.bottomLeft, quadrilateral.bottomLeft),
          };
        }

        previousCornersRef.current = newQuad;
        setDisplayQuad(newQuad);
        setDisplayDimensions(dimensions);
        setDisplayReadiness(captureReadiness);
      } else if (displayQuad && !graceTimerRef.current) {
        // Start grace period
        graceTimerRef.current = setTimeout(() => {
          setDisplayQuad(null);
          previousCornersRef.current = null;
        }, OVERLAY_GRACE_MS);
      }
    }, [quadrilateral, dimensions, captureReadiness, isPaused]);

    // Nothing to show if no active or graceful quad
    if (!displayQuad || !displayDimensions || isPaused) return null;

    const { topLeft, topRight, bottomRight, bottomLeft } = displayQuad;

    const strokeColor = getStrokeColor(displayReadiness);
    const fillColor   = getFillColor(displayReadiness);
    const strokeW     = displayReadiness >= 80 ? 7 : 5;

    const polygonPts  = [
      `${topLeft.x},${topLeft.y}`,
      `${topRight.x},${topRight.y}`,
      `${bottomRight.x},${bottomRight.y}`,
      `${bottomLeft.x},${bottomLeft.y}`,
    ].join(' ');

    // Corner bracket length — 7% of the shorter frame dimension
    const bracketLen = Math.min(displayDimensions.width, displayDimensions.height) * 0.07;
    const bW         = strokeW + 2; // bracket lines are slightly thicker than outline

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg
          height="100%"
          width="100%"
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${displayDimensions.width} ${displayDimensions.height}`}
          preserveAspectRatio="xMidYMid slice"
        >
          {/* ── Document outline ─────────────────────────────────────── */}
          <Polygon
            points={polygonPts}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            strokeOpacity={0.9}
          />

          {/* ── Top-Left corner bracket ───────────────────────────────── */}
          <Line x1={topLeft.x} y1={topLeft.y} x2={topLeft.x + bracketLen} y2={topLeft.y}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />
          <Line x1={topLeft.x} y1={topLeft.y} x2={topLeft.x} y2={topLeft.y + bracketLen}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />

          {/* ── Top-Right corner bracket ──────────────────────────────── */}
          <Line x1={topRight.x} y1={topRight.y} x2={topRight.x - bracketLen} y2={topRight.y}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />
          <Line x1={topRight.x} y1={topRight.y} x2={topRight.x} y2={topRight.y + bracketLen}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />

          {/* ── Bottom-Right corner bracket ───────────────────────────── */}
          <Line x1={bottomRight.x} y1={bottomRight.y} x2={bottomRight.x - bracketLen} y2={bottomRight.y}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />
          <Line x1={bottomRight.x} y1={bottomRight.y} x2={bottomRight.x} y2={bottomRight.y - bracketLen}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />

          {/* ── Bottom-Left corner bracket ────────────────────────────── */}
          <Line x1={bottomLeft.x} y1={bottomLeft.y} x2={bottomLeft.x + bracketLen} y2={bottomLeft.y}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />
          <Line x1={bottomLeft.x} y1={bottomLeft.y} x2={bottomLeft.x} y2={bottomLeft.y - bracketLen}
            stroke={strokeColor} strokeWidth={bW} strokeLinecap="round" />
        </Svg>
      </View>
    );
  }
);

DocumentContourOverlay.displayName = 'DocumentContourOverlay';
