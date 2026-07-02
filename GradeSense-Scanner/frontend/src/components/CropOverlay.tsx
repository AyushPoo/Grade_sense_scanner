import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    View,
    StyleSheet,
    PanResponder,
    useWindowDimensions,
    TouchableOpacity,
    Text,
    ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Quadrilateral } from '../utils/cvProcessor';
import Svg, { Polygon, Line, Circle } from 'react-native-svg';
import * as ImageManipulator from 'expo-image-manipulator';
import { isConvexQuad, hasConsistentWinding, minimumEdgeLengthValid, getFallbackA4Quad } from '../utils/geometryUtils';

const ENABLE_MANUAL_CROP_VALIDATION = true;
const ENABLE_EXIF_NORMALIZATION = true;

interface CropOverlayProps {
    imageUri: string;
    initialQuad?: Quadrilateral;
    onCropComplete: (quad: Quadrilateral) => void;
    onCancel: () => void;
}

const CORNER_HIT_SIZE = 52; // touch target size
const CORNER_DOT_SIZE = 22; // visual dot size
const LOUPE_SIZE = 120;
const ZOOM_FACTOR = 2.5;

type Corner = keyof Quadrilateral;

export function CropOverlay({ imageUri, initialQuad, onCropComplete, onCancel }: CropOverlayProps) {
    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
    const [normalizedImageUri, setNormalizedImageUri] = useState<string | null>(null);
    const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
    const [containerDims, setContainerDims] = useState<{ width: number; height: number; scale: number } | null>(null);
    const [points, setPoints] = useState<Quadrilateral | null>(null);
    type Edge = 'topEdge' | 'rightEdge' | 'bottomEdge' | 'leftEdge';
    type DragTarget = Corner | Edge;

    const [activeCorner, setActiveCorner] = useState<DragTarget | null>(null);

    // All refs that PanResponders need to see up-to-date
    const pointsRef = useRef<Quadrilateral | null>(null);
    const containerRef = useRef<{ width: number; height: number; scale: number } | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const activeCornerRef = useRef<DragTarget | null>(null);

    // Keep refs in sync with state
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { containerRef.current = containerDims; }, [containerDims]);

    // EXIF Normalization & Dimension Loading
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                // Bake EXIF rotation into the pixel data natively (must match scanner.tsx)
                const result = await ImageManipulator.manipulateAsync(
                    imageUri,
                    [{ rotate: 0 }],
                    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                );
                if (isMounted) {
                    setNormalizedImageUri(result.uri);
                    setImageDims({ width: result.width, height: result.height });
                }
            } catch (err) {
                try {
                    const result = await ImageManipulator.manipulateAsync(imageUri, []);
                    if (isMounted) {
                        setNormalizedImageUri(imageUri);
                        setImageDims({ width: result.width, height: result.height });
                    }
                } catch (fallbackErr) {
                    console.warn('[CropOverlay] Failed to load image dimensions:', fallbackErr);
                }
            }
        })();
        return () => { isMounted = false; };
    }, [imageUri]);

    // Compute container size and initial quad
    useEffect(() => {
        if (!imageDims) return;
        const maxWidth = SCREEN_WIDTH;
        const maxHeight = SCREEN_HEIGHT * 0.72;
        const scale = Math.min(maxWidth / imageDims.width, maxHeight / imageDims.height);
        const finalWidth = imageDims.width * scale;
        const finalHeight = imageDims.height * scale;

        const dims = { width: finalWidth, height: finalHeight, scale };
        setContainerDims(dims);
        containerRef.current = dims;

        if (initialQuad) {
            const rawQ = {
                topLeft:     { x: initialQuad.topLeft.x * scale,     y: initialQuad.topLeft.y * scale },
                topRight:    { x: initialQuad.topRight.x * scale,    y: initialQuad.topRight.y * scale },
                bottomRight: { x: initialQuad.bottomRight.x * scale, y: initialQuad.bottomRight.y * scale },
                bottomLeft:  { x: initialQuad.bottomLeft.x * scale,  y: initialQuad.bottomLeft.y * scale },
            };

            const isOffScreen = Object.values(rawQ).some(p => 
                p.x < -finalWidth * 0.1 || p.x > finalWidth * 1.1 || 
                p.y < -finalHeight * 0.1 || p.y > finalHeight * 1.1
            );

            if (isOffScreen || (ENABLE_MANUAL_CROP_VALIDATION && (!isConvexQuad(rawQ) || !hasConsistentWinding(rawQ)))) {
                console.warn("[CropOverlay] initialQuad is invalid or off-screen. Falling back to default pad.");
                applyFallback();
            } else {
                // Clamp to screen edges
                const clampX = (val: number) => Math.max(0, Math.min(val, finalWidth));
                const clampY = (val: number) => Math.max(0, Math.min(val, finalHeight));
                
                const q = {
                    topLeft:     { x: clampX(rawQ.topLeft.x),     y: clampY(rawQ.topLeft.y) },
                    topRight:    { x: clampX(rawQ.topRight.x),    y: clampY(rawQ.topRight.y) },
                    bottomRight: { x: clampX(rawQ.bottomRight.x), y: clampY(rawQ.bottomRight.y) },
                    bottomLeft:  { x: clampX(rawQ.bottomLeft.x),  y: clampY(rawQ.bottomLeft.y) },
                };
                setPoints(q);
                pointsRef.current = q;
            }
        } else {
            applyFallback();
        }

        function applyFallback() {
            const q = getFallbackA4Quad(finalWidth, finalHeight);
            setPoints(q);
            pointsRef.current = q;
        }
    }, [imageDims, SCREEN_WIDTH, SCREEN_HEIGHT, initialQuad]);  // re-run when imageDims, screen dimensions, or initialQuad changes

    // One PanResponder that handles a corner or edge based on activeCornerRef
    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => activeCornerRef.current !== null,
        onMoveShouldSetPanResponder: () => activeCornerRef.current !== null,
        onPanResponderGrant: (evt) => {
            const target = activeCornerRef.current;
            if (!target || !pointsRef.current) return;
            
            let startPt = { x: 0, y: 0 };
            if (target === 'topLeft') {
                startPt = { ...pointsRef.current.topLeft };
            } else if (target === 'topRight') {
                startPt = { ...pointsRef.current.topRight };
            } else if (target === 'bottomRight') {
                startPt = { ...pointsRef.current.bottomRight };
            } else if (target === 'bottomLeft') {
                startPt = { ...pointsRef.current.bottomLeft };
            } else if (target === 'topEdge') {
                startPt = {
                    x: (pointsRef.current.topLeft.x + pointsRef.current.topRight.x) / 2,
                    y: (pointsRef.current.topLeft.y + pointsRef.current.topRight.y) / 2,
                };
            } else if (target === 'bottomEdge') {
                startPt = {
                    x: (pointsRef.current.bottomLeft.x + pointsRef.current.bottomRight.x) / 2,
                    y: (pointsRef.current.bottomLeft.y + pointsRef.current.bottomRight.y) / 2,
                };
            } else if (target === 'leftEdge') {
                startPt = {
                    x: (pointsRef.current.topLeft.x + pointsRef.current.bottomLeft.x) / 2,
                    y: (pointsRef.current.topLeft.y + pointsRef.current.bottomLeft.y) / 2,
                };
            } else if (target === 'rightEdge') {
                startPt = {
                    x: (pointsRef.current.topRight.x + pointsRef.current.bottomRight.x) / 2,
                    y: (pointsRef.current.topRight.y + pointsRef.current.bottomRight.y) / 2,
                };
            }
            dragStartRef.current = startPt;
            setActiveCorner(target);
        },
        onPanResponderMove: (evt, gestureState) => {
            const target = activeCornerRef.current;
            const start = dragStartRef.current;
            const c = containerRef.current;
            if (!target || !start || !c || !pointsRef.current) return;

            const dx = gestureState.dx;
            const dy = gestureState.dy;

            let updated = { ...pointsRef.current };

            const clampX = (val: number) => Math.max(0, Math.min(val, c.width));
            const clampY = (val: number) => Math.max(0, Math.min(val, c.height));

            if (target === 'topLeft') {
                updated.topLeft = { x: clampX(start.x + dx), y: clampY(start.y + dy) };
            } else if (target === 'topRight') {
                updated.topRight = { x: clampX(start.x + dx), y: clampY(start.y + dy) };
            } else if (target === 'bottomRight') {
                updated.bottomRight = { x: clampX(start.x + dx), y: clampY(start.y + dy) };
            } else if (target === 'bottomLeft') {
                updated.bottomLeft = { x: clampX(start.x + dx), y: clampY(start.y + dy) };
            } else if (target === 'topEdge') {
                const newY = clampY(start.y + dy);
                updated.topLeft = { ...updated.topLeft, y: newY };
                updated.topRight = { ...updated.topRight, y: newY };
            } else if (target === 'bottomEdge') {
                const newY = clampY(start.y + dy);
                updated.bottomLeft = { ...updated.bottomLeft, y: newY };
                updated.bottomRight = { ...updated.bottomRight, y: newY };
            } else if (target === 'leftEdge') {
                const newX = clampX(start.x + dx);
                updated.topLeft = { ...updated.topLeft, x: newX };
                updated.bottomLeft = { ...updated.bottomLeft, x: newX };
            } else if (target === 'rightEdge') {
                const newX = clampX(start.x + dx);
                updated.topRight = { ...updated.topRight, x: newX };
                updated.bottomRight = { ...updated.bottomRight, x: newX };
            }

            if (ENABLE_MANUAL_CROP_VALIDATION) {
                const isValidGeometry = hasConsistentWinding(updated) && isConvexQuad(updated) && minimumEdgeLengthValid(updated, 0.1, c.width, c.height);
                if (!isValidGeometry) {
                    return; // Prevent update
                }
            }

            pointsRef.current = updated;
            setPoints(updated);
        },
        onPanResponderRelease: () => {
            activeCornerRef.current = null;
            dragStartRef.current = null;
            setActiveCorner(null);
        },
        onPanResponderTerminate: () => {
            activeCornerRef.current = null;
            dragStartRef.current = null;
            setActiveCorner(null);
        },
    }), []); // created once, reads everything from refs

    const handleSave = () => {
        if (pointsRef.current && containerRef.current) {
            const { scale } = containerRef.current;
            const q = pointsRef.current;
            const exportedQuad = {
                topLeft:     { x: q.topLeft.x / scale,     y: q.topLeft.y / scale },
                topRight:    { x: q.topRight.x / scale,    y: q.topRight.y / scale },
                bottomRight: { x: q.bottomRight.x / scale, y: q.bottomRight.y / scale },
                bottomLeft:  { x: q.bottomLeft.x / scale,  y: q.bottomLeft.y / scale },
            };
            console.log('[CV-AUDIT] CropOverlay.handleSave', {
                imageDims,
                exportedQuad,
            });
            onCropComplete(exportedQuad);
        }
    };

    if (!containerDims || !points) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>Loading image…</Text>
            </View>
        );
    }

    const polyPts = `${points.topLeft.x},${points.topLeft.y} ${points.topRight.x},${points.topRight.y} ${points.bottomRight.x},${points.bottomRight.y} ${points.bottomLeft.x},${points.bottomLeft.y}`;

    const corners: { corner: Corner; p: { x: number; y: number } }[] = [
        { corner: 'topLeft',     p: points.topLeft },
        { corner: 'topRight',    p: points.topRight },
        { corner: 'bottomRight', p: points.bottomRight },
        { corner: 'bottomLeft',  p: points.bottomLeft },
    ];

    const midpoints = {
        topEdge: {
            x: (points.topLeft.x + points.topRight.x) / 2,
            y: (points.topLeft.y + points.topRight.y) / 2,
        },
        bottomEdge: {
            x: (points.bottomLeft.x + points.bottomRight.x) / 2,
            y: (points.bottomLeft.y + points.bottomRight.y) / 2,
        },
        leftEdge: {
            x: (points.topLeft.x + points.bottomLeft.x) / 2,
            y: (points.topLeft.y + points.bottomLeft.y) / 2,
        },
        rightEdge: {
            x: (points.topRight.x + points.bottomRight.x) / 2,
            y: (points.topRight.y + points.bottomRight.y) / 2,
        },
    };

    const edgeHandles: { edge: Edge; p: { x: number; y: number } }[] = [
        { edge: 'topEdge', p: midpoints.topEdge },
        { edge: 'bottomEdge', p: midpoints.bottomEdge },
        { edge: 'leftEdge', p: midpoints.leftEdge },
        { edge: 'rightEdge', p: midpoints.rightEdge },
    ];

    const getActivePoint = (): { x: number; y: number } | null => {
        if (!activeCorner) return null;
        if (activeCorner === 'topLeft') return points.topLeft;
        if (activeCorner === 'topRight') return points.topRight;
        if (activeCorner === 'bottomRight') return points.bottomRight;
        if (activeCorner === 'bottomLeft') return points.bottomLeft;
        if (activeCorner === 'topEdge') return midpoints.topEdge;
        if (activeCorner === 'bottomEdge') return midpoints.bottomEdge;
        if (activeCorner === 'leftEdge') return midpoints.leftEdge;
        if (activeCorner === 'rightEdge') return midpoints.rightEdge;
        return null;
    };

    const activePoint = getActivePoint();
    let loupeStyle: any = null;
    let zoomedImageStyle: any = null;

    if (activeCorner && activePoint) {
        const px = activePoint.x;
        const py = activePoint.y;

        const offset = 45; // gap above/below touch point
        const preferredY = py - LOUPE_SIZE - offset;
        const loupeY = preferredY >= 10 ? preferredY : py + offset;

        const loupeX = Math.max(10, Math.min(px - LOUPE_SIZE / 2, containerDims.width - LOUPE_SIZE - 10));
        const clampedY = Math.max(10, Math.min(loupeY, containerDims.height - LOUPE_SIZE - 10));

        loupeStyle = {
            position: 'absolute',
            left: loupeX,
            top: clampedY,
            width: LOUPE_SIZE,
            height: LOUPE_SIZE,
            borderRadius: LOUPE_SIZE / 2,
            borderWidth: 2,
            borderColor: '#2196F3',
            backgroundColor: '#000',
            overflow: 'hidden',
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 5,
            zIndex: 9999,
        };

        zoomedImageStyle = {
            position: 'absolute',
            width: containerDims.width * ZOOM_FACTOR,
            height: containerDims.height * ZOOM_FACTOR,
            left: -px * ZOOM_FACTOR + LOUPE_SIZE / 2,
            top: -py * ZOOM_FACTOR + LOUPE_SIZE / 2,
        };
    }

    return (
        <View style={styles.root}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onCancel} style={styles.btn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Adjust Crop</Text>
                <TouchableOpacity onPress={handleSave} style={styles.btn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
            </View>

            {/* Image + Overlay */}
            <View style={styles.content}>
                <View
                    style={{ width: containerDims.width, height: containerDims.height }}
                    {...panResponder.panHandlers}
                >
                    {/* Raw image */}
                    <ExpoImage
                        source={{ uri: normalizedImageUri || imageUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="fill"
                    />

                    {/* Dimming outside crop region via SVG */}
                    <Svg
                        height={containerDims.height}
                        width={containerDims.width}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                    >
                        {/* Blue outline */}
                        <Polygon
                            points={polyPts}
                            fill="rgba(33,150,243,0.15)"
                            stroke="#2196F3"
                            strokeWidth="2"
                        />
                        {/* Edge lines */}
                        <Line x1={points.topLeft.x} y1={points.topLeft.y} x2={points.topRight.x} y2={points.topRight.y} stroke="#2196F3" strokeWidth="2" />
                        <Line x1={points.topRight.x} y1={points.topRight.y} x2={points.bottomRight.x} y2={points.bottomRight.y} stroke="#2196F3" strokeWidth="2" />
                        <Line x1={points.bottomRight.x} y1={points.bottomRight.y} x2={points.bottomLeft.x} y2={points.bottomLeft.y} stroke="#2196F3" strokeWidth="2" />
                        <Line x1={points.bottomLeft.x} y1={points.bottomLeft.y} x2={points.topLeft.x} y2={points.topLeft.y} stroke="#2196F3" strokeWidth="2" />
                        
                        {/* Midpoint intersecting crosshair guides when dragging */}
                        {activePoint && (
                            <>
                                <Line 
                                    x1={0} 
                                    y1={activePoint.y} 
                                    x2={containerDims.width} 
                                    y2={activePoint.y} 
                                    stroke="rgba(33,150,243,0.75)" 
                                    strokeWidth="1.5" 
                                    strokeDasharray="4,4" 
                                />
                                <Line 
                                    x1={activePoint.x} 
                                    y1={0} 
                                    x2={activePoint.x} 
                                    y2={containerDims.height} 
                                    stroke="rgba(33,150,243,0.75)" 
                                    strokeWidth="1.5" 
                                    strokeDasharray="4,4" 
                                />
                            </>
                        )}

                        {/* Glowing corner dots */}
                        {corners.map(({ corner, p }) => (
                            <Circle key={corner} cx={p.x} cy={p.y} r={CORNER_DOT_SIZE / 2} fill="#2196F3" stroke="#fff" strokeWidth="2" />
                        ))}

                        {/* Midpoint edge handles */}
                        {edgeHandles.map(({ edge, p }) => (
                            <Circle 
                                key={edge} 
                                cx={p.x} 
                                cy={p.y} 
                                r={CORNER_DOT_SIZE * 0.4} 
                                fill="#EF9F27" 
                                stroke="#fff" 
                                strokeWidth="2" 
                            />
                        ))}
                    </Svg>

                    {/* Invisible large touch targets for each corner */}
                    {corners.map(({ corner, p }) => (
                        <View
                            key={corner}
                            onStartShouldSetResponder={() => {
                                activeCornerRef.current = corner;
                                return false; // let panResponder take over
                            }}
                            style={[
                                styles.cornerHit,
                                {
                                    left: p.x - CORNER_HIT_SIZE / 2,
                                    top:  p.y - CORNER_HIT_SIZE / 2,
                                },
                            ]}
                        />
                    ))}

                    {/* Invisible large touch targets for each edge midpoint */}
                    {edgeHandles.map(({ edge, p }) => (
                        <View
                            key={edge}
                            onStartShouldSetResponder={() => {
                                activeCornerRef.current = edge;
                                return false; // let panResponder take over
                            }}
                            style={[
                                styles.cornerHit,
                                {
                                    left: p.x - CORNER_HIT_SIZE / 2,
                                    top:  p.y - CORNER_HIT_SIZE / 2,
                                },
                            ]}
                        />
                    ))}

                    {/* Magnifying glass loupe */}
                    {activeCorner && activePoint && (
                        <View style={loupeStyle} pointerEvents="none">
                            <ExpoImage
                                source={{ uri: normalizedImageUri || imageUri }}
                                style={zoomedImageStyle}
                                contentFit="fill"
                            />
                            {/* Crosshair lines */}
                            <View style={styles.crosshairV} />
                            <View style={styles.crosshairH} />
                            <View style={styles.crosshairDot} />
                        </View>
                    )}
                </View>
            </View>

            <View style={styles.hint}>
                <Text style={styles.hintText}>Drag the corners or orange edge midpoints to adjust the crop area</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root:            { flex: 1, backgroundColor: '#111' },
    loadingContainer:{ flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', gap: 12 },
    loadingText:     { color: '#fff', fontSize: 14 },
    header:          {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 54,
        paddingBottom: 14,
        backgroundColor: 'rgba(0,0,0,0.85)',
    },
    title:           { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
    btn:             { minWidth: 60 },
    cancelText:      { color: '#aaa', fontSize: 16 },
    doneText:        { color: '#2196F3', fontSize: 16, fontWeight: '700', textAlign: 'right' },
    content:         { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
    cornerHit:       { position: 'absolute', width: CORNER_HIT_SIZE, height: CORNER_HIT_SIZE },
    hint:            { paddingVertical: 14, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
    hintText:        { color: '#888', fontSize: 13 },
    crosshairV: {
        position: 'absolute',
        left: LOUPE_SIZE / 2 - 0.5,
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: '#2196F3',
        opacity: 0.7,
    },
    crosshairH: {
        position: 'absolute',
        top: LOUPE_SIZE / 2 - 0.5,
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: '#2196F3',
        opacity: 0.7,
    },
    crosshairDot: {
        position: 'absolute',
        left: LOUPE_SIZE / 2 - 3,
        top: LOUPE_SIZE / 2 - 3,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#2196F3',
        borderWidth: 1,
        borderColor: '#fff',
    },
});
