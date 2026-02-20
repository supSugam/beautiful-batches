import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  toEditorCropCoordinates,
  toStoredCoordinates,
} from '../../../utils/cropCoordinates';
import type {
  CropEntry,
  EditorCropCoordinates,
  EditorViewState,
} from '../../../types/app';

const FIT_PADDING_PX = 16;
const MIN_CROP_SIZE = 10;
const SNAP_THRESHOLD = 3;
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
    width: safeWidth * cos + safeHeight * sin,
    height: safeWidth * sin + safeHeight * cos,
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

  const scalarMax = Math.min(maxHeight, maxWidth / safeRatio);
  const scalarMin = Math.min(
    scalarMax,
    Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE / safeRatio),
  );
  const requestedScalar = Math.max(
    0,
    Number(crop?.h) || (Number(crop?.w) || MIN_CROP_SIZE) / safeRatio,
  );
  const scalar = Math.max(scalarMin, Math.min(requestedScalar, scalarMax));
  const w = scalar * safeRatio;
  const h = scalar;

  const source = startCrop || crop;
  const startX = Number(source?.x) || 0;
  const startY = Number(source?.y) || 0;
  const startW = Number(source?.w) || w;
  const startH = Number(source?.h) || h;

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

  // ── Crop state ──────────────────────────────────────────
  const [crop, setCropRaw] = useState(() => {
    const initialCrop = toEditorCropCoordinates(
      initialState?.coordinates,
      initialBounds.width,
      initialBounds.height,
    );
    return clampCropToBounds(initialCrop, initialBounds);
  });

  // Track the ID to forcibly update state when image swaps
  const lastImageIdRef = useRef(imageId);

  useEffect(() => {
    if (imageId !== lastImageIdRef.current) {
      lastImageIdRef.current = imageId;

      const newRotation = normalizeRotation(
        initialState?.transforms?.rotate || 0,
      );
      const newBounds = getRotatedBounds(
        naturalWidth,
        naturalHeight,
        newRotation,
      );
      const newCrop = clampCropToBounds(
        toEditorCropCoordinates(
          initialState?.coordinates,
          newBounds.width,
          newBounds.height,
        ),
        newBounds,
      );
      const newAspect = initialState?.aspect ?? null;
      const newZoom = clampZoom(initialState?.editorView?.zoom ?? MIN_ZOOM);
      const newZoomAnchor = {
        x: toFiniteAnchor(initialState?.editorView?.anchor?.x, 0.5),
        y: toFiniteAnchor(initialState?.editorView?.anchor?.y, 0.5),
      };

      setRotationRaw(newRotation);
      rotationRef.current = newRotation;

      setFlipH(Boolean(initialState?.transforms?.flip?.horizontal));
      flipHRef.current = Boolean(initialState?.transforms?.flip?.horizontal);

      setFlipV(Boolean(initialState?.transforms?.flip?.vertical));
      flipVRef.current = Boolean(initialState?.transforms?.flip?.vertical);

      setAspectState(newAspect);
      aspectRef.current = newAspect;

      setZoomRaw(newZoom);
      zoomRef.current = newZoom;

      setZoomAnchorRaw(newZoomAnchor);
      zoomAnchorRef.current = newZoomAnchor;

      setCropRaw(newCrop);
      cropRef.current = newCrop;
    }
  }, [imageId, naturalWidth, naturalHeight, initialState]);

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

  const cropRef = useRef(crop);
  cropRef.current = crop;
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
  const notifyFrameRef = useRef<number>(0);
  const isInteractingRef = useRef(false);
  const wheelTimeoutRef = useRef<number | null>(null);

  const notifyChange = useCallback(() => {
    if (notifyFrameRef.current) return;
    notifyFrameRef.current = window.setTimeout(() => {
      notifyFrameRef.current = 0;

      const rawCrop = cropRef.current;
      const rawZoom = zoomRef.current;
      const rawAnchor = zoomAnchorRef.current;

      const instantaneousEffectiveCrop = computeEffectiveCrop(
        rawCrop,
        rawZoom,
        rawAnchor,
      );

      onChangeRef.current?.({
        coordinates: toStoredCoordinates(instantaneousEffectiveCrop),
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
      });
    }, 100) as unknown as number;
  }, [computeEffectiveCrop]);

  useEffect(() => {
    return () => {
      if (notifyFrameRef.current) {
        window.clearTimeout(notifyFrameRef.current);
      }
      if (wheelTimeoutRef.current !== null) {
        window.clearTimeout(wheelTimeoutRef.current);
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

    return {
      horizontal: Math.abs(centerX - imageCenterX) < SNAP_THRESHOLD,
      vertical: Math.abs(centerY - imageCenterY) < SNAP_THRESHOLD,
    };
  }, [crop, effectiveWidth, effectiveHeight]);

  // ── Crop operations ─────────────────────────────────────
  const moveCrop = useCallback(
    (dx: number, dy: number) => {
      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw((previous) => {
        const next = clampCropToBounds(
          {
            ...previous,
            x: previous.x + dx,
            y: previous.y + dy,
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

  const resizeCrop = useCallback(
    (
      handleId: string,
      totalDx: number,
      totalDy: number,
      startCrop: EditorCropRect | null,
    ) => {
      if (!startCrop) return;

      let { x, y, w, h } = startCrop;

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

      if (w < MIN_CROP_SIZE) {
        if (handleId.includes('l')) x -= MIN_CROP_SIZE - w;
        w = MIN_CROP_SIZE;
      }
      if (h < MIN_CROP_SIZE) {
        if (handleId.includes('t')) y -= MIN_CROP_SIZE - h;
        h = MIN_CROP_SIZE;
      }

      if (aspectRef.current) {
        const ratio = aspectRef.current;
        if (handleId.includes('r') || handleId.includes('l')) {
          h = w / ratio;
        } else {
          w = h * ratio;
        }
        const bounds = getBoundsForRotation(rotationRef.current);
        const next = clampCropWithAspect(
          { x, y, w, h },
          bounds,
          ratio,
          handleId,
          startCrop,
        );
        cropRef.current = next;
        setCropRaw(next);
        notifyChange();
        return;
      }

      const bounds = getBoundsForRotation(rotationRef.current);
      const next = clampCropToBounds({ x, y, w, h }, bounds);
      cropRef.current = next;
      setCropRaw(next);
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
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

        return clampCropToBounds(
          {
            x: centerX - w / 2,
            y: centerY - h / 2,
            w,
            h,
          },
          bounds,
        );
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
        if (options.remapMode === 'coverage') {
          return remapCropByCoverage(previous, previousBounds, nextBounds);
        }
        return remapCropToBounds(previous, previousBounds, nextBounds);
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
      const nextFine = Math.max(-45, Math.min(45, currentFine + numericDelta));
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
    setCropRaw({
      x: 0,
      y: 0,
      w: resetBounds.width,
      h: resetBounds.height,
    });
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
    setCropRaw({
      x: 0,
      y: 0,
      w: resetBounds.width,
      h: resetBounds.height,
    });
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
        notifyChange();
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
    [scheduleViewCommit, updateZoomAnchorFromClientPoint, notifyChange],
  );

  // ── Drag start/end (for CropOverlay) ────────────────────
  const onDragStart = useCallback(() => {
    isInteractingRef.current = true;
  }, []);
  const onDragEnd = useCallback(() => {
    isInteractingRef.current = false;
    notifyChange();
  }, [notifyChange]);

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

    // Drag
    onDragStart,
    onDragEnd,
  };
}

export type ImageEditorApi = ReturnType<typeof useImageEditor>;

export default useImageEditor;
