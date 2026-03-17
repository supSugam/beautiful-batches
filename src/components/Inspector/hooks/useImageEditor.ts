import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  toEditorCropCoordinates,
  toStoredCoordinates,
} from '../../../utils/cropCoordinates';
import { clampPaddingToReference } from '../../../utils/boxValues';
import { computePaddedContentRect } from '../../../utils/paddedContentRect';
import type {
  CropEntry,
  EditorCropCoordinates,
  EditorViewState,
} from '../../../types/app';

const FIT_PADDING_PX = 16;
const MIN_CROP_SIZE = 10;
const SNAP_THRESHOLD_MIN = 2;
// Target snap zone in screen pixels. Converted to editor coordinates using the fit scale.
const SNAP_THRESHOLD_SCREEN_PX = 6;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_SPEED = 0.0016;
const VIEW_COMMIT_DELAY_MS = 140;

type Bounds = { width: number; height: number };
type EditorCropRect = EditorCropCoordinates;

type UseImageEditorArgs = {
  imageId: string;
  naturalWidth: number;
  naturalHeight: number;
  initialState?: CropEntry;
  onChange?: (state: CropEntry) => void;
  paddingPx?: number;
};

const normalizeRotation = (rotation: unknown): number => {
  const numeric = Number(rotation);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = ((numeric % 360) + 360) % 360;
  return normalized > 359.999 ? 0 : normalized;
};

const normalizeSignedRotation = (rotation: unknown): number => {
  const normalized = normalizeRotation(rotation);
  return normalized > 180 ? normalized - 360 : normalized;
};

const getRotationAnchor = (signedRotation: number): number => {
  let anchor = Math.trunc(signedRotation / 90) * 90;
  const fine = signedRotation - anchor;
  if (fine > 45) anchor += 90;
  if (fine < -45) anchor -= 90;
  return anchor;
};

const getRotatedBounds = (
  width: number,
  height: number,
  rotation: number,
): Bounds => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const radians = (normalizeRotation(rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    // Ceil avoids clipping for non-right-angle rotations and keeps editor coordinates pixel-based.
    width: Math.max(1, Math.ceil(safeWidth * cos + safeHeight * sin)),
    height: Math.max(1, Math.ceil(safeWidth * sin + safeHeight * cos)),
  };
};

const clampZoom = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, numeric));
};

const clampAnchor = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
};

const toFiniteAnchor = (value: unknown, fallback = 0.5): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
};

const clampInRange = (value: unknown, min: number, max: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
};

const SIGNATURE_PRECISION = 1000;
const SYNC_EPSILON = 0.001;

const roundForSignature = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * SIGNATURE_PRECISION) / SIGNATURE_PRECISION;
};

const clampCropToBounds = (
  crop: Partial<EditorCropRect> | null | undefined,
  bounds: Bounds,
): EditorCropRect => {
  const maxWidth = Math.max(1, Number(bounds?.width) || 1);
  const maxHeight = Math.max(1, Number(bounds?.height) || 1);
  const minWidth = Math.min(MIN_CROP_SIZE, maxWidth);
  const minHeight = Math.min(MIN_CROP_SIZE, maxHeight);

  let w = Math.max(minWidth, Math.min(Number(crop?.w) || 0, maxWidth));
  let h = Math.max(minHeight, Math.min(Number(crop?.h) || 0, maxHeight));
  let x = Number(crop?.x) || 0;
  let y = Number(crop?.y) || 0;

  x = Math.max(0, Math.min(x, maxWidth - w));
  y = Math.max(0, Math.min(y, maxHeight - h));

  return { x, y, w, h };
};

const roundCropXY = (crop: EditorCropRect): EditorCropRect => {
  return {
    ...crop,
    x: Math.round(crop.x),
    y: Math.round(crop.y),
  };
};

const roundCropAll = (crop: EditorCropRect): EditorCropRect => {
  return {
    x: Math.round(crop.x),
    y: Math.round(crop.y),
    w: Math.round(crop.w),
    h: Math.round(crop.h),
  };
};

const remapCropToBounds = (
  crop: EditorCropRect,
  previousBounds: Bounds,
  nextBounds: Bounds,
): EditorCropRect => {
  const prevWidth = Math.max(1, Number(previousBounds?.width) || 1);
  const prevHeight = Math.max(1, Number(previousBounds?.height) || 1);
  const nextWidth = Math.max(1, Number(nextBounds?.width) || 1);
  const nextHeight = Math.max(1, Number(nextBounds?.height) || 1);

  const centerX = Number(crop?.x || 0) + Number(crop?.w || 0) / 2;
  const centerY = Number(crop?.y || 0) + Number(crop?.h || 0) / 2;
  const centerXRatio = centerX / prevWidth;
  const centerYRatio = centerY / prevHeight;

  const w = Math.min(Number(crop?.w || MIN_CROP_SIZE), nextWidth);
  const h = Math.min(Number(crop?.h || MIN_CROP_SIZE), nextHeight);

  return clampCropToBounds(
    {
      x: centerXRatio * nextWidth - w / 2,
      y: centerYRatio * nextHeight - h / 2,
      w,
      h,
    },
    nextBounds,
  );
};

const remapCropByCoverage = (
  crop: EditorCropRect,
  previousBounds: Bounds,
  nextBounds: Bounds,
): EditorCropRect => {
  const prevWidth = Math.max(1, Number(previousBounds?.width) || 1);
  const prevHeight = Math.max(1, Number(previousBounds?.height) || 1);
  const nextWidth = Math.max(1, Number(nextBounds?.width) || 1);
  const nextHeight = Math.max(1, Number(nextBounds?.height) || 1);

  const xRatio = (Number(crop?.x) || 0) / prevWidth;
  const yRatio = (Number(crop?.y) || 0) / prevHeight;
  const wRatio = (Number(crop?.w) || 0) / prevWidth;
  const hRatio = (Number(crop?.h) || 0) / prevHeight;

  return clampCropToBounds(
    {
      x: xRatio * nextWidth,
      y: yRatio * nextHeight,
      w: wRatio * nextWidth,
      h: hRatio * nextHeight,
    },
    nextBounds,
  );
};

const clampCropWithAspect = (
  crop: EditorCropRect,
  bounds: Bounds,
  ratio: number,
  handleId: string,
  startCrop: EditorCropRect,
): EditorCropRect => {
  const safeRatio = Math.max(0.000001, Number(ratio) || 1);
  const maxWidth = Math.max(1, Number(bounds?.width) || 1);
  const maxHeight = Math.max(1, Number(bounds?.height) || 1);

  const source = startCrop || crop;
  const startX = Number(source?.x) || 0;
  const startY = Number(source?.y) || 0;
  const startW = Number(source?.w) || MIN_CROP_SIZE * safeRatio;
  const startH = Number(source?.h) || MIN_CROP_SIZE;

  // Determine fixed anchor point based on handle being dragged
  const anchorX = handleId.includes('l')
    ? startX + startW
    : handleId.includes('r')
      ? startX
      : startX + startW / 2;
  const anchorY = handleId.includes('t')
    ? startY + startH
    : handleId.includes('b')
      ? startY
      : startY + startH / 2;

  // Determine max scalar based on fixed anchor and image bounds
  let maxScalarByBound = Math.min(maxHeight, maxWidth / safeRatio);

  if (handleId.includes('t')) {
    maxScalarByBound = Math.min(maxScalarByBound, anchorY);
  } else if (handleId.includes('b')) {
    maxScalarByBound = Math.min(maxScalarByBound, maxHeight - anchorY);
  } else {
    maxScalarByBound = Math.min(maxScalarByBound, 2 * anchorY, 2 * (maxHeight - anchorY));
  }

  if (handleId.includes('l')) {
    maxScalarByBound = Math.min(maxScalarByBound, anchorX / safeRatio);
  } else if (handleId.includes('r')) {
    maxScalarByBound = Math.min(maxScalarByBound, (maxWidth - anchorX) / safeRatio);
  } else {
    maxScalarByBound = Math.min(maxScalarByBound, (2 * anchorX) / safeRatio, (2 * (maxWidth - anchorX)) / safeRatio);
  }

  const requestedScalar = Math.max(
    0,
    Number(crop?.h) || (Number(crop?.w) || MIN_CROP_SIZE) / safeRatio,
  );
  const scalarMin = Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE / safeRatio);
  const finalScalarMax = Math.max(maxScalarByBound, scalarMin);
  const scalar = Math.max(scalarMin, Math.min(requestedScalar, finalScalarMax));
  
  let w = scalar * safeRatio;
  let h = scalar;

  let x = handleId.includes('l')
    ? anchorX - w
    : handleId.includes('r')
      ? anchorX
      : anchorX - w / 2;
  let y = handleId.includes('t')
    ? anchorY - h
    : handleId.includes('b')
      ? anchorY
      : anchorY - h / 2;

  x = Math.max(0, Math.min(x, maxWidth - w));
  y = Math.max(0, Math.min(y, maxHeight - h));

  return { x, y, w, h };
};

const normalizeCoordinatesForEmit = (
  coordinates: ReturnType<typeof toStoredCoordinates>,
  bounds: Bounds,
) => {
  if (!coordinates) return null;
  const maxWidth = Math.max(1, Number(bounds?.width) || 1);
  const maxHeight = Math.max(1, Number(bounds?.height) || 1);
  const width = Math.max(1, Math.min(Math.round(coordinates.width), maxWidth));
  const height = Math.max(1, Math.min(Math.round(coordinates.height), maxHeight));
  const maxLeft = Math.max(0, maxWidth - width);
  const maxTop = Math.max(0, maxHeight - height);
  const left = Math.max(0, Math.min(Math.round(coordinates.left), maxLeft));
  const top = Math.max(0, Math.min(Math.round(coordinates.top), maxTop));
  return { left, top, width, height };
};

const areNumbersEquivalent = (a: number, b: number): boolean =>
  Math.abs(a - b) <= SYNC_EPSILON;

const areCropsEquivalent = (
  a: EditorCropRect,
  b: EditorCropRect,
): boolean =>
  areNumbersEquivalent(a.x, b.x) &&
  areNumbersEquivalent(a.y, b.y) &&
  areNumbersEquivalent(a.w, b.w) &&
  areNumbersEquivalent(a.h, b.h);

const areAspectsEquivalent = (
  a: number | null,
  b: number | null,
): boolean => {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return areNumbersEquivalent(a, b);
};

const buildHydrationSignature = ({
  imageId,
  naturalWidth,
  naturalHeight,
  state,
}: {
  imageId: string;
  naturalWidth: number;
  naturalHeight: number;
  state?: CropEntry;
}): string => {
  const coordinates = state?.coordinates || null;
  const transforms = state?.transforms || null;
  const anchor = state?.editorView?.anchor || null;

  return JSON.stringify({
    imageId: String(imageId || ''),
    naturalWidth: roundForSignature(naturalWidth),
    naturalHeight: roundForSignature(naturalHeight),
    coordinates: coordinates
      ? {
          left: roundForSignature(coordinates.left),
          top: roundForSignature(coordinates.top),
          width: roundForSignature(coordinates.width),
          height: roundForSignature(coordinates.height),
        }
      : null,
    transforms: {
      rotate: roundForSignature(normalizeRotation(transforms?.rotate || 0)),
      flipH: Boolean(transforms?.flip?.horizontal),
      flipV: Boolean(transforms?.flip?.vertical),
    },
    aspect:
      state?.aspect === null || state?.aspect === undefined
        ? null
        : roundForSignature(state.aspect),
    editorView: {
      zoom: roundForSignature(clampZoom(state?.editorView?.zoom ?? MIN_ZOOM)),
      anchor: {
        x: roundForSignature(clampAnchor(anchor?.x ?? 0.5)),
        y: roundForSignature(clampAnchor(anchor?.y ?? 0.5)),
      },
    },
  });
};

/**
 * useImageEditor — unified state machine for image editing.
 *
 * Manages: crop, rotation (90° steps + fine), flip, zoom, aspect ratio.
 *
 * Returns the full editor API consumed by InspectorPreview, CropOverlay,
 * and useInspectorLogic.
 */
export function useImageEditor({
  imageId,
  naturalWidth,
  naturalHeight,
  initialState,
  onChange,
  paddingPx = 0,
}: UseImageEditorArgs) {
  const initialRotation = normalizeRotation(
    initialState?.transforms?.rotate || 0,
  );
  const initialBounds = getRotatedBounds(
    naturalWidth,
    naturalHeight,
    initialRotation,
  );
  const initialZoom = clampZoom(initialState?.editorView?.zoom ?? MIN_ZOOM);
  const initialZoomAnchor = {
    x: toFiniteAnchor(initialState?.editorView?.anchor?.x, 0.5),
    y: toFiniteAnchor(initialState?.editorView?.anchor?.y, 0.5),
  };

  // ── Container size ──────────────────────────────────────
  const [containerSize, setContainerSizeState] = useState({
    width: 0,
    height: 0,
  });

  const setContainerSize = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      setContainerSizeState((previous) => {
        if (previous.width === width && previous.height === height)
          return previous;
        return { width, height };
      });
    },
    [],
  );

  // ── Core transform state ────────────────────────────────
  const [rotation, setRotationRaw] = useState(initialRotation);
  const [flipH, setFlipH] = useState(() => {
    return Boolean(initialState?.transforms?.flip?.horizontal);
  });
  const [flipV, setFlipV] = useState(() => {
    return Boolean(initialState?.transforms?.flip?.vertical);
  });
  const [zoom, setZoomRaw] = useState(initialZoom);
  const [zoomAnchor, setZoomAnchorRaw] =
    useState<EditorViewState['anchor']>(initialZoomAnchor);
  const [aspect, setAspectState] = useState<number | null>(() => {
    return initialState?.aspect ?? null;
  });

  const getBoundsForRotation = useCallback(
    (rotationValue: number) =>
      getRotatedBounds(naturalWidth, naturalHeight, rotationValue),
    [naturalWidth, naturalHeight],
  );

  // ── Effective dimensions (after rotation) ───────────────
  const effectiveBounds = useMemo(
    () => getBoundsForRotation(rotation),
    [getBoundsForRotation, rotation],
  );
  const effectiveWidth = effectiveBounds.width;
  const effectiveHeight = effectiveBounds.height;

  // Snap threshold in editor coordinates, tuned to feel consistent at different preview scales.
  const snapThreshold = useMemo(() => {
    const cw = containerSize.width;
    const ch = containerSize.height;
    if (cw <= 0 || ch <= 0 || effectiveWidth <= 0 || effectiveHeight <= 0) {
      return SNAP_THRESHOLD_MIN;
    }

    const availableWidth = cw - FIT_PADDING_PX * 2;
    const availableHeight = ch - FIT_PADDING_PX * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return SNAP_THRESHOLD_MIN;

    const scale = Math.min(availableWidth / effectiveWidth, availableHeight / effectiveHeight);
    if (!Number.isFinite(scale) || scale <= 0.000001) return SNAP_THRESHOLD_MIN;

    return Math.max(SNAP_THRESHOLD_MIN, SNAP_THRESHOLD_SCREEN_PX / scale);
  }, [containerSize.width, containerSize.height, effectiveWidth, effectiveHeight]);

  const snapContentRect = useMemo(() => {
    const evenPadding = Math.max(0, Math.round(Number(paddingPx) || 0));
    if (evenPadding <= 0) return null;
    const paddingValues = clampPaddingToReference(
      String(evenPadding),
      effectiveWidth,
      effectiveHeight,
    );
    return computePaddedContentRect(
      effectiveWidth,
      effectiveHeight,
      paddingValues,
    );
  }, [effectiveWidth, effectiveHeight, paddingPx]);

  const applyMoveSnapping = useCallback(
    (nextRaw: EditorCropRect, bounds: Bounds): EditorCropRect => {
      const threshold = snapThreshold;

      const candidatesX: number[] = [];
      const candidatesY: number[] = [];

      const centerX = nextRaw.x + nextRaw.w / 2;
      const centerY = nextRaw.y + nextRaw.h / 2;
      const imageCenterX = bounds.width / 2;
      const imageCenterY = bounds.height / 2;

      const centerDx = imageCenterX - centerX;
      const centerDy = imageCenterY - centerY;
      if (Math.abs(centerDx) < threshold) candidatesX.push(centerDx);
      if (Math.abs(centerDy) < threshold) candidatesY.push(centerDy);

      // Always allow snapping to outer canvas bounds.
      const leftDx = 0 - nextRaw.x;
      const rightDx = bounds.width - (nextRaw.x + nextRaw.w);
      if (Math.abs(leftDx) < threshold) candidatesX.push(leftDx);
      if (Math.abs(rightDx) < threshold) candidatesX.push(rightDx);

      const topDy = 0 - nextRaw.y;
      const bottomDy = bounds.height - (nextRaw.y + nextRaw.h);
      if (Math.abs(topDy) < threshold) candidatesY.push(topDy);
      if (Math.abs(bottomDy) < threshold) candidatesY.push(bottomDy);

      // Snap to padded content boundary (so users can crop padding cleanly).
      if (snapContentRect) {
        const contentLeftDx = snapContentRect.x - nextRaw.x;
        const contentRightDx =
          snapContentRect.x + snapContentRect.width - (nextRaw.x + nextRaw.w);
        if (Math.abs(contentLeftDx) < threshold) candidatesX.push(contentLeftDx);
        if (Math.abs(contentRightDx) < threshold) candidatesX.push(contentRightDx);

        const contentTopDy = snapContentRect.y - nextRaw.y;
        const contentBottomDy =
          snapContentRect.y + snapContentRect.height - (nextRaw.y + nextRaw.h);
        if (Math.abs(contentTopDy) < threshold) candidatesY.push(contentTopDy);
        if (Math.abs(contentBottomDy) < threshold) candidatesY.push(contentBottomDy);
      }

      const pickBest = (values: number[]) => {
        let best = 0;
        let bestAbs = Number.POSITIVE_INFINITY;
        for (const value of values) {
          const abs = Math.abs(value);
          if (abs < bestAbs) {
            bestAbs = abs;
            best = value;
          }
        }
        return bestAbs !== Number.POSITIVE_INFINITY ? best : 0;
      };

      const dx = pickBest(candidatesX);
      const dy = pickBest(candidatesY);
      if (dx === 0 && dy === 0) return nextRaw;

      return {
        ...nextRaw,
        x: nextRaw.x + dx,
        y: nextRaw.y + dy,
      };
    },
    [snapContentRect, snapThreshold],
  );

  const applyResizeSnapping = useCallback(
    (nextRaw: EditorCropRect, handleId: string, bounds: Bounds): EditorCropRect => {
      const threshold = snapThreshold;
      let { x, y, w, h } = nextRaw;

      const targetsX = [0, bounds.width];
      const targetsY = [0, bounds.height];
      if (snapContentRect) {
        targetsX.push(snapContentRect.x);
        targetsX.push(snapContentRect.x + snapContentRect.width);
        targetsY.push(snapContentRect.y);
        targetsY.push(snapContentRect.y + snapContentRect.height);
      }

      const bestDelta = (deltas: number[]) => {
        let best: number | null = null;
        for (const delta of deltas) {
          if (Math.abs(delta) >= threshold) continue;
          if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
        }
        return best ?? 0;
      };

      if (handleId.includes('r')) {
        const right = x + w;
        const delta = bestDelta(targetsX.map((t) => t - right));
        const nextW = w + delta;
        if (nextW >= MIN_CROP_SIZE) w = nextW;
      }

      if (handleId.includes('l')) {
        const delta = bestDelta(targetsX.map((t) => t - x));
        if (delta !== 0) {
          const nextX = x + delta;
          const nextW = w - delta;
          if (nextW >= MIN_CROP_SIZE) {
            x = nextX;
            w = nextW;
          }
        }
      }

      if (handleId.includes('b')) {
        const bottom = y + h;
        const delta = bestDelta(targetsY.map((t) => t - bottom));
        const nextH = h + delta;
        if (nextH >= MIN_CROP_SIZE) h = nextH;
      }

      if (handleId.includes('t')) {
        const delta = bestDelta(targetsY.map((t) => t - y));
        if (delta !== 0) {
          const nextY = y + delta;
          const nextH = h - delta;
          if (nextH >= MIN_CROP_SIZE) {
            y = nextY;
            h = nextH;
          }
        }
      }

      return { x, y, w, h };
    },
    [snapContentRect, snapThreshold],
  );

  // ── Crop state ──────────────────────────────────────────
  const [crop, setCropRaw] = useState(() => {
    const initialCrop = toEditorCropCoordinates(
      initialState?.coordinates,
      initialBounds.width,
      initialBounds.height,
    );
    return clampCropToBounds(initialCrop, initialBounds);
  });

  const cropRef = useRef(crop);
  cropRef.current = crop;
  const imageIdRef = useRef(imageId);
  imageIdRef.current = imageId;
  const naturalWidthRef = useRef(naturalWidth);
  naturalWidthRef.current = naturalWidth;
  const naturalHeightRef = useRef(naturalHeight);
  naturalHeightRef.current = naturalHeight;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const flipHRef = useRef(flipH);
  flipHRef.current = flipH;
  const flipVRef = useRef(flipV);
  flipVRef.current = flipV;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomAnchorRef = useRef(zoomAnchor);
  zoomAnchorRef.current = zoomAnchor;
  const isInteractingRef = useRef(false);
  const lastHydrationSignatureRef = useRef('');
  const lastEmittedSignatureRef = useRef('');
  const pendingHydrationRef = useRef<{
    signature: string;
    state: CropEntry | undefined;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const notifyFrameRef = useRef<number>(0);
  const wheelTimeoutRef = useRef<number | null>(null);

  const applyHydrationState = useCallback(
    ({
      signature,
      state,
      naturalWidth: stateNaturalWidth,
      naturalHeight: stateNaturalHeight,
    }: {
      signature: string;
      state: CropEntry | undefined;
      naturalWidth: number;
      naturalHeight: number;
    }) => {
      const newRotation = normalizeRotation(state?.transforms?.rotate || 0);
      const newBounds = getRotatedBounds(
        stateNaturalWidth,
        stateNaturalHeight,
        newRotation,
      );
      const newCrop = clampCropToBounds(
        toEditorCropCoordinates(
          state?.coordinates,
          newBounds.width,
          newBounds.height,
        ),
        newBounds,
      );
      const newFlipH = Boolean(state?.transforms?.flip?.horizontal);
      const newFlipV = Boolean(state?.transforms?.flip?.vertical);
      const newAspect = state?.aspect ?? null;
      const newZoom = clampZoom(state?.editorView?.zoom ?? MIN_ZOOM);
      const newZoomAnchor = {
        x: toFiniteAnchor(state?.editorView?.anchor?.x, 0.5),
        y: toFiniteAnchor(state?.editorView?.anchor?.y, 0.5),
      };
      const rotationChanged = !areNumbersEquivalent(
        rotationRef.current,
        newRotation,
      );
      const flipHChanged = flipHRef.current !== newFlipH;
      const flipVChanged = flipVRef.current !== newFlipV;
      const aspectChanged = !areAspectsEquivalent(aspectRef.current, newAspect);
      const zoomChanged = !areNumbersEquivalent(zoomRef.current, newZoom);
      const zoomAnchorChanged =
        !areNumbersEquivalent(zoomAnchorRef.current.x, newZoomAnchor.x) ||
        !areNumbersEquivalent(zoomAnchorRef.current.y, newZoomAnchor.y);
      const cropChanged = !areCropsEquivalent(cropRef.current, newCrop);

      if (
        !rotationChanged &&
        !flipHChanged &&
        !flipVChanged &&
        !aspectChanged &&
        !zoomChanged &&
        !zoomAnchorChanged &&
        !cropChanged
      ) {
        lastHydrationSignatureRef.current = signature;
        return false;
      }

      if (rotationChanged) {
        setRotationRaw(newRotation);
        rotationRef.current = newRotation;
      }
      if (flipHChanged) {
        setFlipH(newFlipH);
        flipHRef.current = newFlipH;
      }
      if (flipVChanged) {
        setFlipV(newFlipV);
        flipVRef.current = newFlipV;
      }
      if (aspectChanged) {
        setAspectState(newAspect);
        aspectRef.current = newAspect;
      }
      if (zoomChanged) {
        setZoomRaw(newZoom);
        zoomRef.current = newZoom;
      }
      if (zoomAnchorChanged) {
        setZoomAnchorRaw(newZoomAnchor);
        zoomAnchorRef.current = newZoomAnchor;
      }
      if (cropChanged) {
        setCropRaw(newCrop);
        cropRef.current = newCrop;
      }

      lastHydrationSignatureRef.current = signature;
      return true;
    },
    [],
  );

  const flushPendingHydration = useCallback(() => {
    const pending = pendingHydrationRef.current;
    if (!pending) return false;
    pendingHydrationRef.current = null;

    if (pending.signature === lastHydrationSignatureRef.current) {
      return false;
    }
    if (pending.signature === lastEmittedSignatureRef.current) {
      lastHydrationSignatureRef.current = pending.signature;
      return false;
    }

    return applyHydrationState(pending);
  }, [applyHydrationState]);

  useLayoutEffect(() => {
    // Treat image switches as a hard interaction boundary so stale wheel/drag
    // timers cannot re-emit previous geometry into the next image state.
    isInteractingRef.current = false;
    pendingHydrationRef.current = null;
    if (notifyFrameRef.current) {
      window.clearTimeout(notifyFrameRef.current);
      notifyFrameRef.current = 0;
    }
    if (wheelTimeoutRef.current !== null) {
      window.clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = null;
    }

    const incomingSignature = buildHydrationSignature({
      imageId,
      naturalWidth,
      naturalHeight,
      state: initialState,
    });

    if (incomingSignature === lastHydrationSignatureRef.current) {
      pendingHydrationRef.current = null;
      return;
    }

    // Ignore our own state echoes to avoid snapping while editing.
    if (incomingSignature === lastEmittedSignatureRef.current) {
      lastHydrationSignatureRef.current = incomingSignature;
      pendingHydrationRef.current = null;
      return;
    }

    if (isInteractingRef.current) {
      pendingHydrationRef.current = {
        signature: incomingSignature,
        state: initialState,
        naturalWidth,
        naturalHeight,
      };
      return;
    }

    pendingHydrationRef.current = null;
    applyHydrationState({
      signature: incomingSignature,
      state: initialState,
      naturalWidth,
      naturalHeight,
    });
  }, [
    applyHydrationState,
    imageId,
    naturalWidth,
    naturalHeight,
    initialState,
  ]);

  // ── Effective (Visual) Crop ──────────────────────────────
  // This accounts for the current zoom and pan (zoomAnchor) to define
  // the actual region of the image being selected.
  const computeEffectiveCrop = useCallback(
    (
      currentCrop: EditorCropRect,
      currentZoom: number,
      currentAnchor: { x: number; y: number },
    ) => {
      const w = currentCrop.w / currentZoom;
      const h = currentCrop.h / currentZoom;
      const x =
        currentCrop.x + currentAnchor.x * currentCrop.w * (1 - 1 / currentZoom);
      const y =
        currentCrop.y + currentAnchor.y * currentCrop.h * (1 - 1 / currentZoom);
      return { x, y, w, h };
    },
    [],
  );

  const effectiveCrop = useMemo(
    () => computeEffectiveCrop(crop, zoom, zoomAnchor),
    [crop, zoom, zoomAnchor, computeEffectiveCrop],
  );

  // ── Refs for notify callbacks ───────────────────────────
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emitCurrentState = useCallback(
    (expectedImageId?: string): boolean => {
      if (expectedImageId && expectedImageId !== imageIdRef.current) {
        return false;
      }

      const rawCrop = cropRef.current;
      const rawZoom = zoomRef.current;
      const rawAnchor = zoomAnchorRef.current;

      const instantaneousEffectiveCrop = computeEffectiveCrop(
        rawCrop,
        rawZoom,
        rawAnchor,
      );
      const currentBounds = getRotatedBounds(
        naturalWidthRef.current,
        naturalHeightRef.current,
        rotationRef.current,
      );
      const normalizedCoordinates = normalizeCoordinatesForEmit(
        toStoredCoordinates(instantaneousEffectiveCrop),
        currentBounds,
      );

      const nextState: CropEntry = {
        coordinates: normalizedCoordinates,
        transforms: {
          rotate: rotationRef.current,
          flip: {
            horizontal: flipHRef.current,
            vertical: flipVRef.current,
          },
        },
        isInteracting: isInteractingRef.current,
        aspect: aspectRef.current,
        editorView: {
          zoom: 1,
          anchor: { x: 0.5, y: 0.5 },
        },
      };

      const signature = buildHydrationSignature({
        imageId: imageIdRef.current,
        naturalWidth: naturalWidthRef.current,
        naturalHeight: naturalHeightRef.current,
        state: nextState,
      });
      if (signature === lastEmittedSignatureRef.current) {
        return true;
      }

      lastEmittedSignatureRef.current = signature;
      onChangeRef.current?.(nextState);
      return true;
    },
    [computeEffectiveCrop],
  );

  const notifyChange = useCallback(() => {
    if (notifyFrameRef.current) return;
    const scheduledImageId = imageIdRef.current;
    notifyFrameRef.current = window.setTimeout(() => {
      notifyFrameRef.current = 0;
      emitCurrentState(scheduledImageId);
    }, 100) as unknown as number;
  }, [emitCurrentState]);

  const commitChangeNow = useCallback(() => {
    if (notifyFrameRef.current) {
      window.clearTimeout(notifyFrameRef.current);
      notifyFrameRef.current = 0;
    }
    emitCurrentState(imageIdRef.current);
  }, [emitCurrentState]);
  const emitCurrentStateRef = useRef(emitCurrentState);
  emitCurrentStateRef.current = emitCurrentState;

  useEffect(() => {
    return () => {
      if (notifyFrameRef.current) {
        window.clearTimeout(notifyFrameRef.current);
        notifyFrameRef.current = 0;
        emitCurrentStateRef.current(imageIdRef.current);
      }
      if (wheelTimeoutRef.current !== null) {
        window.clearTimeout(wheelTimeoutRef.current);
        wheelTimeoutRef.current = null;
      }
    };
  }, []);

  const scheduleViewCommit = useCallback(() => {
    notifyChange();
  }, [notifyChange]);

  // ── Fit layout (how image fits in container) ────────────
  const fitLayout = useMemo(() => {
    const cw = containerSize.width;
    const ch = containerSize.height;
    if (cw <= 0 || ch <= 0 || effectiveWidth <= 0 || effectiveHeight <= 0) {
      return null;
    }

    const availableWidth = cw - FIT_PADDING_PX * 2;
    const availableHeight = ch - FIT_PADDING_PX * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return null;

    const scale = Math.min(
      availableWidth / effectiveWidth,
      availableHeight / effectiveHeight,
    );
    const displayW = effectiveWidth * scale;
    const displayH = effectiveHeight * scale;
    const offsetX = (cw - displayW) / 2;
    const offsetY = (ch - displayH) / 2;

    return {
      scale,
      offsetX,
      offsetY,
      displayW,
      displayH,
    };
  }, [
    containerSize.width,
    containerSize.height,
    effectiveWidth,
    effectiveHeight,
  ]);

  // ── Center snap detection ───────────────────────────────
  const centerStatus = useMemo(() => {
    const centerX = crop.x + crop.w / 2;
    const centerY = crop.y + crop.h / 2;
    const imageCenterX = effectiveWidth / 2;
    const imageCenterY = effectiveHeight / 2;

    // "Snapped" should mean actually aligned (pixel-level), not just "near".
    const EPS = 0.0001;
    return {
      horizontal: Math.abs(centerX - imageCenterX) < EPS,
      vertical: Math.abs(centerY - imageCenterY) < EPS,
    };
  }, [crop, effectiveWidth, effectiveHeight]);

  // ── Crop operations ─────────────────────────────────────
  // Pointer move events can fire extremely frequently; updating React state on every event
  // makes the whole app feel laggy. Coalesce crop updates to 1 per animation frame.
  const pendingMoveDeltaRef = useRef<{ totalDx: number; totalDy: number; startCrop: EditorCropRect | null; bypassSnap: boolean; lockRatio: boolean }>({ totalDx: 0, totalDy: 0, startCrop: null, bypassSnap: false, lockRatio: false });
  const pendingMoveRafRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{
    handleId: string;
    totalDx: number;
    totalDy: number;
    startCrop: EditorCropRect | null;
    bypassSnap: boolean;
    lockRatio: boolean;
  } | null>(null);
  const pendingResizeRafRef = useRef<number | null>(null);

  const applyMoveNow = useCallback(
    (totalDx: number, totalDy: number, startCrop: EditorCropRect | null, bypassSnap: boolean, _lockRatio: boolean) => {
      if (!startCrop) return;
      const bounds = getBoundsForRotation(rotationRef.current);
      const unclamped = {
        ...startCrop,
        x: startCrop.x + totalDx,
        y: startCrop.y + totalDy,
      };
      const clamped = clampCropToBounds(unclamped, bounds);
      const snapped = bypassSnap ? clamped : clampCropToBounds(applyMoveSnapping(clamped, bounds), bounds);
      const next = clampCropToBounds(roundCropXY(snapped), bounds);
      cropRef.current = next;
      setCropRaw(next);
    },
    [applyMoveSnapping, getBoundsForRotation],
  );

  const applyResizeNow = useCallback(
    (
      handleId: string,
      totalDx: number,
      totalDy: number,
      startCrop: EditorCropRect | null,
      bypassSnap: boolean,
      lockRatio: boolean
    ) => {
      if (!startCrop) return;

      let { x, y, w, h } = startCrop;
      const bounds = getBoundsForRotation(rotationRef.current);

      if (handleId.includes('r')) w += totalDx;
      if (handleId.includes('l')) {
        x += totalDx;
        w -= totalDx;
      }
      if (handleId.includes('b')) h += totalDy;
      if (handleId.includes('t')) {
        y += totalDy;
        h -= totalDy;
      }

      const startRight = startCrop.x + startCrop.w;
      const startBottom = startCrop.y + startCrop.h;

      if (handleId.includes('r')) {
          const maxRight = bounds.width;
          const currentRight = x + w;
          if (currentRight > maxRight) w = maxRight - x;
          if (w < MIN_CROP_SIZE) w = MIN_CROP_SIZE;
      }
      if (handleId.includes('l')) {
          const maxLeft = startRight - MIN_CROP_SIZE;
          if (x > maxLeft) { x = maxLeft; w = MIN_CROP_SIZE; }
          if (x < 0) {
              const diff = 0 - x;
              x = 0;
              w -= diff;
          }
      }
      if (handleId.includes('b')) {
          const maxBottom = bounds.height;
          const currentBottom = y + h;
          if (currentBottom > maxBottom) h = maxBottom - y;
          if (h < MIN_CROP_SIZE) h = MIN_CROP_SIZE;
      }
      if (handleId.includes('t')) {
          const maxTop = startBottom - MIN_CROP_SIZE;
          if (y > maxTop) { y = maxTop; h = MIN_CROP_SIZE; }
          if (y < 0) {
              const diff = 0 - y;
              y = 0;
              h -= diff;
          }
      }

      const effectiveRatio = aspectRef.current || (lockRatio && startCrop.w > 0 && startCrop.h > 0 ? startCrop.w / startCrop.h : null);
      
      if (effectiveRatio) {
        const ratio = effectiveRatio;
        if (handleId.includes('r') || handleId.includes('l')) {
          h = w / ratio;
        } else {
          w = h * ratio;
        }
        const next = clampCropWithAspect(
          { x, y, w, h },
          bounds,
          ratio,
          handleId,
          startCrop,
        );
        cropRef.current = next;
        setCropRaw(next);
        return;
      }

      const clamped = clampCropToBounds({ x, y, w, h }, bounds);
      const snapped = bypassSnap ? clamped : clampCropToBounds(
        applyResizeSnapping(clamped, handleId, bounds),
        bounds,
      );
      const next = clampCropToBounds(roundCropAll(snapped), bounds);
      cropRef.current = next;
      setCropRaw(next);
    },
    [applyResizeSnapping, getBoundsForRotation],
  );

  const flushPendingCropFrame = useCallback(() => {
    let didFlush = false;

    if (pendingMoveRafRef.current !== null) {
      window.cancelAnimationFrame(pendingMoveRafRef.current);
      pendingMoveRafRef.current = null;
      const pending = pendingMoveDeltaRef.current;
      pendingMoveDeltaRef.current = { totalDx: 0, totalDy: 0, startCrop: null, bypassSnap: false, lockRatio: false };
      if (pending.startCrop) {
        applyMoveNow(pending.totalDx, pending.totalDy, pending.startCrop, pending.bypassSnap, pending.lockRatio);
        didFlush = true;
      }
    }

    if (pendingResizeRafRef.current !== null) {
      window.cancelAnimationFrame(pendingResizeRafRef.current);
      pendingResizeRafRef.current = null;
      const pending = pendingResizeRef.current;
      pendingResizeRef.current = null;
      if (pending && pending.startCrop) {
        applyResizeNow(pending.handleId, pending.totalDx, pending.totalDy, pending.startCrop, pending.bypassSnap, pending.lockRatio);
        didFlush = true;
      }
    }

    return didFlush;
  }, [applyMoveNow, applyResizeNow]);

  useLayoutEffect(() => {
    // Reset any in-flight drag frames when the image changes.
    pendingMoveDeltaRef.current = { totalDx: 0, totalDy: 0, startCrop: null, bypassSnap: false, lockRatio: false };
    if (pendingMoveRafRef.current !== null) {
      window.cancelAnimationFrame(pendingMoveRafRef.current);
      pendingMoveRafRef.current = null;
    }
    pendingResizeRef.current = null;
    if (pendingResizeRafRef.current !== null) {
      window.cancelAnimationFrame(pendingResizeRafRef.current);
      pendingResizeRafRef.current = null;
    }
  }, [imageId]);

  useEffect(() => {
    return () => {
      // Ensure we don't leave rAF callbacks scheduled after unmount.
      pendingMoveDeltaRef.current = { totalDx: 0, totalDy: 0, startCrop: null, bypassSnap: false, lockRatio: false };
      if (pendingMoveRafRef.current !== null) {
        window.cancelAnimationFrame(pendingMoveRafRef.current);
        pendingMoveRafRef.current = null;
      }
      pendingResizeRef.current = null;
      if (pendingResizeRafRef.current !== null) {
        window.cancelAnimationFrame(pendingResizeRafRef.current);
        pendingResizeRafRef.current = null;
      }
    };
  }, []);

  const moveCrop = useCallback(
    (totalDx: number, totalDy: number, startCrop: EditorCropRect | null, bypassSnap = false, lockRatio = false) => {
      pendingMoveDeltaRef.current = {
        totalDx: Number(totalDx) || 0,
        totalDy: Number(totalDy) || 0,
        startCrop,
        bypassSnap,
        lockRatio
      };
      if (pendingMoveRafRef.current !== null) return;
      pendingMoveRafRef.current = window.requestAnimationFrame(() => {
        pendingMoveRafRef.current = null;
        const pending = pendingMoveDeltaRef.current;
        pendingMoveDeltaRef.current = { totalDx: 0, totalDy: 0, startCrop: null, bypassSnap: false, lockRatio: false };
        if (!pending.startCrop) return;
        applyMoveNow(pending.totalDx, pending.totalDy, pending.startCrop, pending.bypassSnap, pending.lockRatio);
        notifyChange();
      });
    },
    [applyMoveNow, notifyChange],
  );

  const resizeCrop = useCallback(
    (
      handleId: string,
      totalDx: number,
      totalDy: number,
      startCrop: EditorCropRect | null,
      bypassSnap = false,
      lockRatio = false
    ) => {
      pendingResizeRef.current = {
        handleId,
        totalDx: Number(totalDx) || 0,
        totalDy: Number(totalDy) || 0,
        startCrop,
        bypassSnap,
        lockRatio
      };
      if (pendingResizeRafRef.current !== null) return;
      pendingResizeRafRef.current = window.requestAnimationFrame(() => {
        pendingResizeRafRef.current = null;
        const pending = pendingResizeRef.current;
        pendingResizeRef.current = null;
        if (!pending) return;
        applyResizeNow(pending.handleId, pending.totalDx, pending.totalDy, pending.startCrop, pending.bypassSnap, pending.lockRatio);
        notifyChange();
      });
    },
    [applyResizeNow, notifyChange],
  );

  const setCropDimensions = useCallback(
    (w: number, h: number) => {
      const z = zoomRef.current;
      const targetW = w * z;
      const targetH = h * z;

      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw((previous) => {
        const centerX = previous.x + previous.w / 2;
        const centerY = previous.y + previous.h / 2;
        const next = clampCropToBounds(
          {
            x: centerX - targetW / 2,
            y: centerY - targetH / 2,
            w: targetW,
            h: targetH,
          },
          bounds,
        );
        cropRef.current = next;
        return next;
      });
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  const resetCrop = useCallback(() => {
    const bounds = getBoundsForRotation(rotationRef.current);
    const maxWidth = bounds.width;
    const maxHeight = bounds.height;

    if (aspectRef.current) {
      const ratio = aspectRef.current;
      let w;
      let h;

      if (maxWidth / maxHeight > ratio) {
        h = maxHeight;
        w = h * ratio;
      } else {
        w = maxWidth;
        h = w / ratio;
      }

      const next = clampCropToBounds(
        {
          x: (maxWidth - w) / 2,
          y: (maxHeight - h) / 2,
          w,
          h,
        },
        bounds,
      );
      cropRef.current = next;
      setCropRaw(next);
    } else {
      const next = clampCropToBounds(
        {
          x: 0,
          y: 0,
          w: maxWidth,
          h: maxHeight,
        },
        bounds,
      );
      cropRef.current = next;
      setCropRaw(next);
    }

    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  const centerCrop = useCallback(() => {
    const bounds = getBoundsForRotation(rotationRef.current);
    setCropRaw((previous) => {
      const next = clampCropToBounds(
        {
          x: (bounds.width - previous.w) / 2,
          y: (bounds.height - previous.h) / 2,
          w: previous.w,
          h: previous.h,
        },
        bounds,
      );
      cropRef.current = next;
      return next;
    });
    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  // ── Aspect ratio ────────────────────────────────────────
  const setAspect = useCallback(
    (value: number | null) => {
      setAspectState(value);
      aspectRef.current = value;

      if (value === null) {
        notifyChange();
        return;
      }

      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw((previous) => {
        const maxWidth = bounds.width;
        const maxHeight = bounds.height;

        let w = previous.w;
        let h = w / value;

        if (h > maxHeight) {
          h = maxHeight;
          w = h * value;
        }
        if (w > maxWidth) {
          w = maxWidth;
          h = w / value;
        }

        const centerX = previous.x + previous.w / 2;
        const centerY = previous.y + previous.h / 2;

        const next = clampCropToBounds(
          {
            x: centerX - w / 2,
            y: centerY - h / 2,
            w,
            h,
          },
          bounds,
        );
        cropRef.current = next;
        return next;
      });
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  // ── Rotation ────────────────────────────────────────────
  const applyRotationDelta = useCallback(
    (
      delta: number,
      options: { resetZoom?: boolean; remapMode?: 'coverage' | 'fit' } = {},
    ) => {
      const numericDelta = Number(delta);
      if (!Number.isFinite(numericDelta) || Math.abs(numericDelta) < 0.000001) {
        return;
      }

      const previousRotation = rotationRef.current;
      const nextRotation = normalizeRotation(previousRotation + numericDelta);
      const previousBounds = getBoundsForRotation(previousRotation);
      const nextBounds = getBoundsForRotation(nextRotation);

      rotationRef.current = nextRotation;
      setRotationRaw(nextRotation);
      setCropRaw((previous) => {
        const nextCrop =
          options.remapMode === 'coverage'
            ? remapCropByCoverage(previous, previousBounds, nextBounds)
            : remapCropToBounds(previous, previousBounds, nextBounds);
        cropRef.current = nextCrop;
        return nextCrop;
      });

      if (options.resetZoom) {
        zoomRef.current = MIN_ZOOM;
        zoomAnchorRef.current = { x: 0.5, y: 0.5 };
        setZoomRaw(MIN_ZOOM);
        setZoomAnchorRaw({ x: 0.5, y: 0.5 });
      }
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  const rotateBy = useCallback(
    (delta: number) => {
      applyRotationDelta(delta, { resetZoom: true, remapMode: 'coverage' });
    },
    [applyRotationDelta],
  );

  const setRotationDelta = useCallback(
    (delta: number) => {
      const numericDelta = Number(delta);
      if (!Number.isFinite(numericDelta) || Math.abs(numericDelta) < 0.000001) {
        return;
      }

      const signedRotation = normalizeSignedRotation(rotationRef.current);
      const anchor = getRotationAnchor(signedRotation);
      const currentFine = signedRotation - anchor;
      let nextFine = Math.max(-45, Math.min(45, currentFine + numericDelta));
      // Smart magnet to 0° so users can "find" straight quickly.
      const ZERO_SNAP_DEG = 1.25;
      if (Math.abs(nextFine) < ZERO_SNAP_DEG) nextFine = 0;
      const boundedDelta = nextFine - currentFine;

      if (Math.abs(boundedDelta) < 0.000001) return;
      applyRotationDelta(boundedDelta);
    },
    [applyRotationDelta],
  );

  // ── Flip ────────────────────────────────────────────────
  const flipHorizontal = useCallback(() => {
    setFlipH((previous) => {
      const next = !previous;
      flipHRef.current = next;
      return next;
    });
    notifyChange();
  }, [notifyChange]);

  const flipVertical = useCallback(() => {
    setFlipV((previous) => {
      const next = !previous;
      flipVRef.current = next;
      return next;
    });
    notifyChange();
  }, [notifyChange]);

  // ── Reset ───────────────────────────────────────────────
  const resetTransforms = useCallback(() => {
    rotationRef.current = 0;
    flipHRef.current = false;
    flipVRef.current = false;
    setRotationRaw(0);
    setFlipH(false);
    setFlipV(false);
    zoomRef.current = MIN_ZOOM;
    zoomAnchorRef.current = { x: 0.5, y: 0.5 };
    setZoomRaw(MIN_ZOOM);
    setZoomAnchorRaw({ x: 0.5, y: 0.5 });

    const resetBounds = getBoundsForRotation(0);
    const resetCrop = {
      x: 0,
      y: 0,
      w: resetBounds.width,
      h: resetBounds.height,
    };
    cropRef.current = resetCrop;
    setCropRaw(resetCrop);
    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  const resetAll = useCallback(() => {
    rotationRef.current = 0;
    flipHRef.current = false;
    flipVRef.current = false;
    aspectRef.current = null;
    setRotationRaw(0);
    setFlipH(false);
    setFlipV(false);
    zoomRef.current = MIN_ZOOM;
    zoomAnchorRef.current = { x: 0.5, y: 0.5 };
    setZoomRaw(MIN_ZOOM);
    setZoomAnchorRaw({ x: 0.5, y: 0.5 });
    setAspectState(null);

    const resetBounds = getBoundsForRotation(0);
    const resetCrop = {
      x: 0,
      y: 0,
      w: resetBounds.width,
      h: resetBounds.height,
    };
    cropRef.current = resetCrop;
    setCropRaw(resetCrop);
    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  // ── Zoom ────────────────────────────────────────────────
  const updateZoomAnchorFromClientPoint = useCallback(
    ({
      clientX,
      clientY,
      containerElement,
    }: {
      clientX: number;
      clientY: number;
      containerElement: HTMLElement | null;
    }) => {
      if (!fitLayout || !containerElement) return;

      const rect = containerElement.getBoundingClientRect?.();
      if (!rect) return;

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const relativeX = (localX - fitLayout.offsetX) / fitLayout.displayW;
      const relativeY = (localY - fitLayout.offsetY) / fitLayout.displayH;
      const nextAnchor = {
        x: clampAnchor(relativeX),
        y: clampAnchor(relativeY),
      };

      setZoomAnchorRaw(nextAnchor);
      zoomAnchorRef.current = nextAnchor;
    },
    [fitLayout],
  );

  const setZoom = useCallback(
    (nextZoom: number) => {
      const normalized = clampZoom(nextZoom);
      zoomRef.current = normalized;
      setZoomRaw(normalized);
      scheduleViewCommit();
    },
    [scheduleViewCommit],
  );

  const setZoomAtClientPoint = useCallback(
    (
      nextZoom: number,
      clientX: number,
      clientY: number,
      containerElement: HTMLElement | null,
    ) => {
      updateZoomAnchorFromClientPoint({ clientX, clientY, containerElement });
      const normalized = clampZoom(nextZoom);
      zoomRef.current = normalized;
      setZoomRaw(normalized);
      scheduleViewCommit();
    },
    [scheduleViewCommit, updateZoomAnchorFromClientPoint],
  );

  const panZoomByScreenDelta = useCallback(
    (deltaX: number, deltaY: number) => {
      if (zoom <= MIN_ZOOM + 0.0001 || !fitLayout) return;
      if (fitLayout.displayW <= 0 || fitLayout.displayH <= 0) return;

      const zoomDelta = zoom - 1;
      if (zoomDelta <= 0.000001) return;

      const displayW = fitLayout.displayW;
      const displayH = fitLayout.displayH;
      const cropLeft = crop.x * fitLayout.scale;
      const cropTop = crop.y * fitLayout.scale;
      const cropRight = cropLeft + crop.w * fitLayout.scale;
      const cropBottom = cropTop + crop.h * fitLayout.scale;

      const minAnchorX = -cropLeft / (zoomDelta * displayW);
      const maxAnchorX = (zoom * displayW - cropRight) / (zoomDelta * displayW);
      const minAnchorY = -cropTop / (zoomDelta * displayH);
      const maxAnchorY =
        (zoom * displayH - cropBottom) / (zoomDelta * displayH);

      const denomX = (1 - zoom) * displayW;
      const denomY = (1 - zoom) * displayH;
      if (Math.abs(denomX) < 0.000001 || Math.abs(denomY) < 0.000001) return;

      setZoomAnchorRaw((previous) => {
        const next = {
          x: clampInRange(previous.x + deltaX / denomX, minAnchorX, maxAnchorX),
          y: clampInRange(previous.y + deltaY / denomY, minAnchorY, maxAnchorY),
        };
        zoomAnchorRef.current = next;
        return next;
      });
      scheduleViewCommit();
    },
    [crop.h, crop.w, crop.x, crop.y, fitLayout, scheduleViewCommit, zoom],
  );

  const fillToAvoidBlanks = useCallback(() => {
    const rad = (rotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));

    // Current dimensions
    const curW = crop.w;
    const curH = crop.h;

    // Dimensions of crop box when aligned to image axes
    const cw = curW * absCos + curH * absSin;
    const ch = curW * absSin + curH * absCos;

    // Shrink if necessary to fit anywhere
    const k = Math.min(
      1,
      naturalWidth / Math.max(1, cw),
      naturalHeight / Math.max(1, ch),
    );

    const w = curW * k;
    const h = curH * k;

    // Recalculate cw, ch for possibly shrunk dimensions
    const cw_final = w * absCos + h * absSin;
    const ch_final = w * absSin + h * absCos;

    // Safe range for center relative to image center (in image axes)
    const sx = (naturalWidth - cw_final) / 2;
    const sy = (naturalHeight - ch_final) / 2;

    // Current center relative to image center
    const curCenterX = crop.x + curW / 2;
    const curCenterY = crop.y + curH / 2;
    const imgCenterX = effectiveWidth / 2;
    const imgCenterY = effectiveHeight / 2;

    const dx = curCenterX - imgCenterX;
    const dy = curCenterY - imgCenterY;

    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Vector from image center to crop center
    // u, v are coordinates in a frame that rotates WITH the image.
    // u = dx * cos + dy * sin
    // v = -dx * sin + dy * cos
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;

    // Clamp u, v to safe range
    const nu = Math.max(-sx, Math.min(sx, u));
    const nv = Math.max(-sy, Math.min(sy, v));

    // Back to screen coordinates
    // dx' = nu * cos - nv * sin
    // dy' = nu * sin + nv * cos
    const ndx = nu * cos - nv * sin;
    const ndy = nu * sin + nv * cos;

    const finalX = imgCenterX + ndx - w / 2;
    const finalY = imgCenterY + ndy - h / 2;

    const bounds = getBoundsForRotation(rotation);
    const nextCrop = clampCropToBounds({ x: finalX, y: finalY, w, h }, bounds);
    cropRef.current = nextCrop;
    setCropRaw(nextCrop);
    setZoom(1); // Smart fill usually resets to unzoomed to show the new zone
    setZoomAnchorRaw({ x: 0.5, y: 0.5 });
    zoomAnchorRef.current = { x: 0.5, y: 0.5 };
    notifyChange();
  }, [
    crop,
    effectiveWidth,
    effectiveHeight,
    getBoundsForRotation,
    naturalHeight,
    naturalWidth,
    notifyChange,
    rotation,
    setZoom,
  ]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event) return;
      event.preventDefault();

      const deltaY = Number(event.deltaY) || 0;
      if (Math.abs(deltaY) < 0.0001) return;

      isInteractingRef.current = true;
      if (wheelTimeoutRef.current !== null) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = window.setTimeout(() => {
        isInteractingRef.current = false;
        const appliedPendingHydration = flushPendingHydration();
        if (!appliedPendingHydration) {
          commitChangeNow();
        }
      }, 150);

      updateZoomAnchorFromClientPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        containerElement: event.currentTarget as HTMLElement | null,
      });

      const zoomFactor = Math.exp(-deltaY * WHEEL_ZOOM_SPEED);
      const nextZoom = clampZoom(zoomRef.current * zoomFactor);
      zoomRef.current = nextZoom;
      setZoomRaw(nextZoom);
      scheduleViewCommit();
    },
    [
      scheduleViewCommit,
      updateZoomAnchorFromClientPoint,
      commitChangeNow,
      flushPendingHydration,
    ],
  );

  // ── Drag start/end (for CropOverlay) ────────────────────
  const onDragStart = useCallback(() => {
    isInteractingRef.current = true;
  }, []);
  const onDragEnd = useCallback(() => {
    isInteractingRef.current = false;
    flushPendingCropFrame();
    const appliedPendingHydration = flushPendingHydration();
    if (!appliedPendingHydration) {
      commitChangeNow();
    }
  }, [commitChangeNow, flushPendingCropFrame, flushPendingHydration]);

  // ── Return full API ─────────────────────────────────────
  return {
    // Image info
    naturalWidth,
    naturalHeight,
    effectiveWidth,
    effectiveHeight,

    // Container
    setContainerSize,

    // Crop
    crop,
    effectiveCrop,
    moveCrop,
    resizeCrop,
    setCropDimensions,
    resetCrop,
    centerCrop,

    // Aspect
    aspect,
    setAspect,

    // Transforms
    rotation,
    flipH,
    flipV,
    rotateBy,
    setRotationDelta,
    flipHorizontal,
    flipVertical,
    resetTransforms,
    resetAll,

    // Zoom
    zoom,
    setZoom,
    setZoomAtClientPoint,
    panZoomByScreenDelta,
    fillToAvoidBlanks,
    zoomAnchor,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    handleWheel,

    // Layout
    fitLayout,

    // Center snap
    centerStatus,
    snapThreshold,

    // Drag
    onDragStart,
    onDragEnd,
    commitChangeNow,
  };
}

export type ImageEditorApi = ReturnType<typeof useImageEditor>;

export default useImageEditor;
