import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    View,
    StyleSheet,
    PanResponder,
    Dimensions,
    TouchableOpacity,
    Text,
    ActivityIndicator,
    Image as RNImage,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Quadrilateral } from '../utils/cvProcessor';
import Svg, { Polygon, Line, Circle } from 'react-native-svg';
import * as ImageManipulator from 'expo-image-manipulator';
import { isConvexQuad, hasConsistentWinding, minimumEdgeLengthValid } from '../utils/geometryUtils';

const ENABLE_MANUAL_CROP_VALIDATION = true;
const ENABLE_EXIF_NORMALIZATION = true;

interface CropOverlayProps {
    imageUri: string;
    initialQuad?: Quadrilateral;
    onCropComplete: (quad: Quadrilateral) => void;
    onCancel: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CORNER_HIT_SIZE = 52; // touch target size
const CORNER_DOT_SIZE = 22; // visual dot size

type Corner = keyof Quadrilateral;

export function CropOverlay({ imageUri, initialQuad, onCropComplete, onCancel }: CropOverlayProps) {
    const [normalizedImageUri, setNormalizedImageUri] = useState<string | null>(null);
    const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
    const [containerDims, setContainerDims] = useState<{ width: number; height: number; scale: number } | null>(null);
    const [points, setPoints] = useState<Quadrilateral | null>(null);

    // All refs that PanResponders need to see up-to-date
    const pointsRef = useRef<Quadrilateral | null>(null);
    const containerRef = useRef<{ width: number; height: number; scale: number } | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const activeCornerRef = useRef<Corner | null>(null);

    // Keep refs in sync with state
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { containerRef.current = containerDims; }, [containerDims]);

    // EXIF Normalization
    useEffect(() => {
        let isMounted = true;
        if (!ENABLE_EXIF_NORMALIZATION) {
            setNormalizedImageUri(imageUri);
            return;
        }
        (async () => {
            try {
                // Bake EXIF rotation into the pixel data natively (must match scanner.tsx)
                const result = await ImageManipulator.manipulateAsync(
                    imageUri,
                    [{ rotate: 0 }],
                    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                );
                if (isMounted) setNormalizedImageUri(result.uri);
            } catch (err) {
                if (isMounted) setNormalizedImageUri(imageUri);
            }
        })();
        return () => { isMounted = false; };
    }, [imageUri]);

    // Load image dimensions
    useEffect(() => {
        if (!normalizedImageUri) return;
        RNImage.getSize(normalizedImageUri, (w, h) => setImageDims({ width: w, height: h }));
    }, [normalizedImageUri]);

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
                useFallback();
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
            useFallback();
        }

        function useFallback() {
            const padX = finalWidth * 0.08;
            const padY = finalHeight * 0.08;
            const q = {
                topLeft:     { x: padX,               y: padY },
                topRight:    { x: finalWidth - padX,  y: padY },
                bottomRight: { x: finalWidth - padX,  y: finalHeight - padY },
                bottomLeft:  { x: padX,               y: finalHeight - padY },
            };
            setPoints(q);
            pointsRef.current = q;
        }
    }, [imageDims]);  // only re-run when imageDims changes, not initialQuad

    // One PanResponder that handles a corner based on activeCornerRef
    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => activeCornerRef.current !== null,
        onMoveShouldSetPanResponder: () => activeCornerRef.current !== null,
        onPanResponderGrant: (evt) => {
            const corner = activeCornerRef.current;
            if (!corner || !pointsRef.current) return;
            dragStartRef.current = { ...pointsRef.current[corner] };
        },
        onPanResponderMove: (evt, gestureState) => {
            const corner = activeCornerRef.current;
            const start = dragStartRef.current;
            const c = containerRef.current;
            if (!corner || !start || !c || !pointsRef.current) return;

            const newX = Math.max(0, Math.min(start.x + gestureState.dx, c.width));
            const newY = Math.max(0, Math.min(start.y + gestureState.dy, c.height));

            const updated = { ...pointsRef.current, [corner]: { x: newX, y: newY } };
            
            if (ENABLE_MANUAL_CROP_VALIDATION) {
                // Validate convexity, winding, and edge length (e.g. 10% of shortest container side)
                const isValidGeometry = hasConsistentWinding(updated) && isConvexQuad(updated) && minimumEdgeLengthValid(updated, 0.1, c.width, c.height);
                if (!isValidGeometry) {
                    if (__DEV__) console.log("[DEBUG] Invalid crop geometry rejected.");
                    return; // Prevent update
                }
            }
            
            pointsRef.current = updated;
            setPoints(updated);
        },
        onPanResponderRelease: () => {
            activeCornerRef.current = null;
            dragStartRef.current = null;
        },
        onPanResponderTerminate: () => {
            activeCornerRef.current = null;
            dragStartRef.current = null;
        },
    }), []); // created once, reads everything from refs

    const handleSave = () => {
        if (pointsRef.current && containerRef.current) {
            const { scale } = containerRef.current;
            const q = pointsRef.current;
            onCropComplete({
                topLeft:     { x: q.topLeft.x / scale,     y: q.topLeft.y / scale },
                topRight:    { x: q.topRight.x / scale,    y: q.topRight.y / scale },
                bottomRight: { x: q.bottomRight.x / scale, y: q.bottomRight.y / scale },
                bottomLeft:  { x: q.bottomLeft.x / scale,  y: q.bottomLeft.y / scale },
            });
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
                        contentFit="contain"
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
                        {/* Glowing corner dots */}
                        {corners.map(({ corner, p }) => (
                            <Circle key={corner} cx={p.x} cy={p.y} r={CORNER_DOT_SIZE / 2} fill="#2196F3" stroke="#fff" strokeWidth="2" />
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
                </View>
            </View>

            <View style={styles.hint}>
                <Text style={styles.hintText}>Drag the corners to adjust the crop area</Text>
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
});
