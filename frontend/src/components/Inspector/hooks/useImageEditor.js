import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  toEditorCropCoordinates,
  toStoredCoordinates,
} from '../../../utils/cropCoordinates';

const FIT_PADDING_PX = 16;
const MIN_CROP_SIZE = 10;
const SNAP_THRESHOLD = 3;

const normalizeRotation = (rotation) => {
  const numeric = Number(rotation);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = ((numeric % 360) + 360) % 360;
  return normalized > 359.999 ? 0 : normalized;
};

const normalizeSignedRotation = (rotation) => {
  const normalized = normalizeRotation(rotation);
  return normalized > 180 ? normalized - 360 : normalized;
};

const getRotationAnchor = (signedRotation) => {
  let anchor = Math.trunc(signedRotation / 90) * 90;
  const fine = signedRotation - anchor;
  if (fine > 45) anchor += 90;
  if (fine < -45) anchor -= 90;
  return anchor;
};

const getRotatedBounds = (width, height, rotation) => {
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

const clampCropToBounds = (crop, bounds) => {
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

const remapCropToBounds = (crop, previousBounds, nextBounds) => {
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

const remapCropByCoverage = (crop, previousBounds, nextBounds) => {
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

/**
 * useImageEditor — unified state machine for image editing.
 *
 * Manages: crop, rotation (90° steps + fine), flip, zoom, aspect ratio.
 *
 * Returns the full editor API consumed by InspectorPreview, CropOverlay,
 * and useInspectorLogic.
 */
export function useImageEditor({ naturalWidth, naturalHeight, initialState, onChange }) {
  const initialRotation = normalizeRotation(initialState?.transforms?.rotate || 0);
  const initialBounds = getRotatedBounds(naturalWidth, naturalHeight, initialRotation);

  // ── Container size ──────────────────────────────────────
  const [containerSize, setContainerSizeState] = useState({ width: 0, height: 0 });

  const setContainerSize = useCallback(({ width, height }) => {
    setContainerSizeState((previous) => {
      if (previous.width === width && previous.height === height) return previous;
      return { width, height };
    });
  }, []);

  // ── Core transform state ────────────────────────────────
  const [rotation, setRotationRaw] = useState(initialRotation);
  const [flipH, setFlipH] = useState(() => {
    return Boolean(initialState?.transforms?.flip?.horizontal);
  });
  const [flipV, setFlipV] = useState(() => {
    return Boolean(initialState?.transforms?.flip?.vertical);
  });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspectState] = useState(() => {
    return initialState?.aspect ?? null;
  });

  const getBoundsForRotation = useCallback(
    (rotationValue) => getRotatedBounds(naturalWidth, naturalHeight, rotationValue),
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
  const notifyTimeoutRef = useRef(null);

  const notifyChange = useCallback(() => {
    clearTimeout(notifyTimeoutRef.current);
    notifyTimeoutRef.current = setTimeout(() => {
      onChangeRef.current?.({
        coordinates: toStoredCoordinates(cropRef.current),
        transforms: {
          rotate: rotationRef.current,
          flip: {
            horizontal: flipHRef.current,
            vertical: flipVRef.current,
          },
        },
        aspect: aspectRef.current,
      });
    }, 16);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(notifyTimeoutRef.current);
    };
  }, []);

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

    const scale = Math.min(availableWidth / effectiveWidth, availableHeight / effectiveHeight);
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
  }, [containerSize.width, containerSize.height, effectiveWidth, effectiveHeight]);

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
    (dx, dy) => {
      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw((previous) =>
        clampCropToBounds(
          {
            ...previous,
            x: previous.x + dx,
            y: previous.y + dy,
          },
          bounds,
        ),
      );
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  const resizeCrop = useCallback(
    (handleId, totalDx, totalDy, startCrop) => {
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
      }

      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw(clampCropToBounds({ x, y, w, h }, bounds));
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  const setCropDimensions = useCallback(
    (w, h) => {
      const bounds = getBoundsForRotation(rotationRef.current);
      setCropRaw((previous) => {
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

      setCropRaw(
        clampCropToBounds(
          {
            x: (maxWidth - w) / 2,
            y: (maxHeight - h) / 2,
            w,
            h,
          },
          bounds,
        ),
      );
    } else {
      setCropRaw(
        clampCropToBounds(
          {
            x: 0,
            y: 0,
            w: maxWidth,
            h: maxHeight,
          },
          bounds,
        ),
      );
    }

    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  const centerCrop = useCallback(() => {
    const bounds = getBoundsForRotation(rotationRef.current);
    setCropRaw((previous) =>
      clampCropToBounds(
        {
          x: (bounds.width - previous.w) / 2,
          y: (bounds.height - previous.h) / 2,
          w: previous.w,
          h: previous.h,
        },
        bounds,
      ),
    );
    notifyChange();
  }, [getBoundsForRotation, notifyChange]);

  // ── Aspect ratio ────────────────────────────────────────
  const setAspect = useCallback(
    (value) => {
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
    (delta, options = {}) => {
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
        setZoom(1);
      }
      notifyChange();
    },
    [getBoundsForRotation, notifyChange],
  );

  const rotateBy = useCallback(
    (delta) => {
      applyRotationDelta(delta, { resetZoom: true, remapMode: 'coverage' });
    },
    [applyRotationDelta],
  );

  const setRotationDelta = useCallback(
    (delta) => {
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
    setZoom(1);

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
    setZoom(1);
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
  const handleWheel = useCallback(() => {
    // Disabled for now — zoom is complex and will be re-enabled later
  }, []);

  // ── Drag start/end (for CropOverlay) ────────────────────
  const onDragStart = useCallback(() => {}, []);
  const onDragEnd = useCallback(() => {
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

export default useImageEditor;
