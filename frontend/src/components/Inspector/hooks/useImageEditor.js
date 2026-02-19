import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useImageEditor — unified state machine for image editing.
 *
 * Manages: crop, rotation (90° steps + fine), flip, zoom, aspect ratio.
 *
 * Returns the full editor API consumed by InspectorPreview, CropOverlay,
 * and useInspectorLogic.
 */
export function useImageEditor({ naturalWidth, naturalHeight, initialState, onChange }) {
  // ── Container size ──────────────────────────────────────
  const [containerSize, setContainerSizeState] = useState({ width: 0, height: 0 });

  const setContainerSize = useCallback(({ width, height }) => {
    setContainerSizeState((prev) => {
      if (prev.width === width && prev.height === height) return prev;
      return { width, height };
    });
  }, []);

  // ── Core transform state ────────────────────────────────
  const [rotation, setRotationRaw] = useState(() => {
    return initialState?.transforms?.rotate || 0;
  });
  const [flipH, setFlipH] = useState(() => {
    return initialState?.transforms?.flip?.horizontal || false;
  });
  const [flipV, setFlipV] = useState(() => {
    return initialState?.transforms?.flip?.vertical || false;
  });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspectState] = useState(() => {
    return initialState?.aspect ?? null;
  });

  // ── Effective dimensions (after rotation) ───────────────
  const isOrthogonal = Math.abs(rotation % 180) === 90;
  const effectiveWidth = isOrthogonal ? naturalHeight : naturalWidth;
  const effectiveHeight = isOrthogonal ? naturalWidth : naturalHeight;

  // ── Crop state ──────────────────────────────────────────
  const [crop, setCropRaw] = useState(() => {
    if (initialState?.coordinates) {
      return { ...initialState.coordinates };
    }
    return { x: 0, y: 0, w: effectiveWidth, h: effectiveHeight };
  });

  // ── Refs for onChange callback ───────────────────────────
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const notifyTimeout = useRef(null);

  const notifyChange = useCallback(() => {
    clearTimeout(notifyTimeout.current);
    notifyTimeout.current = setTimeout(() => {
      onChangeRef.current?.({
        coordinates: { ...cropRef.current },
        transforms: {
          rotate: rotationRef.current,
          flip: { horizontal: flipHRef.current, vertical: flipVRef.current },
        },
        aspect: aspectRef.current,
      });
    }, 16);
  }, []);

  // Keep refs in sync for notifyChange
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

  // ── Fit layout (how image fits in container) ────────────
  const fitLayout = useMemo(() => {
    const cw = containerSize.width;
    const ch = containerSize.height;
    if (cw <= 0 || ch <= 0 || effectiveWidth <= 0 || effectiveHeight <= 0) {
      return null;
    }

    // Padding around the image in the container
    const pad = 16;
    const availW = cw - pad * 2;
    const availH = ch - pad * 2;

    const scale = Math.min(availW / effectiveWidth, availH / effectiveHeight);
    const displayW = effectiveWidth * scale;
    const displayH = effectiveHeight * scale;
    const offsetX = (cw - displayW) / 2;
    const offsetY = (ch - displayH) / 2;

    return { scale, offsetX, offsetY, displayW, displayH };
  }, [containerSize.width, containerSize.height, effectiveWidth, effectiveHeight]);

  // ── Clamp crop to effective bounds ──────────────────────
  const clampCrop = useCallback(
    (c) => {
      const ew = isOrthogonal ? naturalHeight : naturalWidth;
      const eh = isOrthogonal ? naturalWidth : naturalHeight;

      // Ensure crop dimensions don't exceed image
      let w = Math.max(10, Math.min(c.w, ew));
      let h = Math.max(10, Math.min(c.h, eh));

      // Clamp position
      let x = Math.max(0, Math.min(c.x, ew - w));
      let y = Math.max(0, Math.min(c.y, eh - h));

      return { x, y, w, h };
    },
    [naturalWidth, naturalHeight, isOrthogonal],
  );

  // ── Center snap detection ───────────────────────────────
  const SNAP_THRESHOLD = 3; // pixels
  const centerStatus = useMemo(() => {
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    const imgCx = effectiveWidth / 2;
    const imgCy = effectiveHeight / 2;

    return {
      horizontal: Math.abs(cx - imgCx) < SNAP_THRESHOLD,
      vertical: Math.abs(cy - imgCy) < SNAP_THRESHOLD,
    };
  }, [crop, effectiveWidth, effectiveHeight]);

  // ── Crop operations ─────────────────────────────────────

  const moveCrop = useCallback(
    (dx, dy) => {
      setCropRaw((prev) => {
        const next = clampCrop({ ...prev, x: prev.x + dx, y: prev.y + dy });
        return next;
      });
      notifyChange();
    },
    [clampCrop, notifyChange],
  );

  const resizeCrop = useCallback(
    (handleId, totalDx, totalDy, startCrop) => {
      if (!startCrop) return;

      let { x, y, w, h } = startCrop;

      // Apply resize based on handle
      if (handleId.includes('r')) { w += totalDx; }
      if (handleId.includes('l')) { x += totalDx; w -= totalDx; }
      if (handleId.includes('b')) { h += totalDy; }
      if (handleId.includes('t')) { y += totalDy; h -= totalDy; }

      // Enforce minimum size
      if (w < 10) { if (handleId.includes('l')) { x -= (10 - w); } w = 10; }
      if (h < 10) { if (handleId.includes('t')) { y -= (10 - h); } h = 10; }

      // Enforce aspect ratio
      if (aspectRef.current) {
        const ar = aspectRef.current;
        if (handleId.includes('r') || handleId.includes('l')) {
          h = w / ar;
        } else {
          w = h * ar;
        }
      }

      setCropRaw(clampCrop({ x, y, w, h }));
      notifyChange();
    },
    [clampCrop, notifyChange],
  );

  const setCropDimensions = useCallback(
    (w, h) => {
      setCropRaw((prev) => {
        // Center the new dimensions around the old center
        const cx = prev.x + prev.w / 2;
        const cy = prev.y + prev.h / 2;
        const x = cx - w / 2;
        const y = cy - h / 2;
        return clampCrop({ x, y, w, h });
      });
      notifyChange();
    },
    [clampCrop, notifyChange],
  );

  const resetCrop = useCallback(() => {
    const ew = isOrthogonal ? naturalHeight : naturalWidth;
    const eh = isOrthogonal ? naturalWidth : naturalHeight;

    if (aspectRef.current) {
      const ar = aspectRef.current;
      let w, h;
      if (ew / eh > ar) {
        h = eh;
        w = h * ar;
      } else {
        w = ew;
        h = w / ar;
      }
      setCropRaw(clampCrop({ x: (ew - w) / 2, y: (eh - h) / 2, w, h }));
    } else {
      setCropRaw({ x: 0, y: 0, w: ew, h: eh });
    }
    notifyChange();
  }, [naturalWidth, naturalHeight, isOrthogonal, clampCrop, notifyChange]);

  const centerCrop = useCallback(() => {
    setCropRaw((prev) => {
      const ew = isOrthogonal ? naturalHeight : naturalWidth;
      const eh = isOrthogonal ? naturalWidth : naturalHeight;
      const x = (ew - prev.w) / 2;
      const y = (eh - prev.h) / 2;
      return clampCrop({ x, y, w: prev.w, h: prev.h });
    });
    notifyChange();
  }, [naturalWidth, naturalHeight, isOrthogonal, clampCrop, notifyChange]);

  // ── Aspect ratio ────────────────────────────────────────
  const setAspect = useCallback(
    (value) => {
      setAspectState(value);
      aspectRef.current = value;

      if (value === null) {
        notifyChange();
        return;
      }

      // Adjust crop to match new aspect ratio
      setCropRaw((prev) => {
        const ew = isOrthogonal ? naturalHeight : naturalWidth;
        const eh = isOrthogonal ? naturalWidth : naturalHeight;

        let w, h;
        // First try to keep width, adjust height
        w = prev.w;
        h = w / value;
        if (h > eh) {
          h = eh;
          w = h * value;
        }
        if (w > ew) {
          w = ew;
          h = w / value;
        }

        // Center on old center
        const cx = prev.x + prev.w / 2;
        const cy = prev.y + prev.h / 2;
        return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
      });
      notifyChange();
    },
    [naturalWidth, naturalHeight, isOrthogonal, clampCrop, notifyChange],
  );

  // ── Rotation ────────────────────────────────────────────

  const normalizeRotation = (r) => ((r % 360) + 360) % 360;

  const rotateBy = useCallback(
    (delta) => {
      const prevEW = isOrthogonal ? naturalHeight : naturalWidth;
      const prevEH = isOrthogonal ? naturalWidth : naturalHeight;

      const newRot = normalizeRotation(rotation + delta);
      setRotationRaw(newRot);

      const newIsOrth = Math.abs(newRot % 180) === 90;
      const newEW = newIsOrth ? naturalHeight : naturalWidth;
      const newEH = newIsOrth ? naturalWidth : naturalHeight;

      // Scale crop proportionally to fit new effective dimensions
      setCropRaw((prev) => {
        const scaleW = newEW / prevEW;
        const scaleH = newEH / prevEH;
        return clampCrop({
          x: prev.x * scaleW,
          y: prev.y * scaleH,
          w: prev.w * scaleW,
          h: prev.h * scaleH,
        });
      });

      setZoom(1); // Reset zoom on rotation
      notifyChange();
    },
    [rotation, naturalWidth, naturalHeight, isOrthogonal, clampCrop, notifyChange],
  );

  const setRotationDelta = useCallback(
    (delta) => {
      const newRot = normalizeRotation(rotation + delta);
      setRotationRaw(newRot);
      notifyChange();
    },
    [rotation, notifyChange],
  );

  // ── Flip ────────────────────────────────────────────────
  const flipHorizontal = useCallback(() => {
    setFlipH((prev) => !prev);
    notifyChange();
  }, [notifyChange]);

  const flipVertical = useCallback(() => {
    setFlipV((prev) => !prev);
    notifyChange();
  }, [notifyChange]);

  // ── Reset ───────────────────────────────────────────────
  const resetTransforms = useCallback(() => {
    setRotationRaw(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    // Reset crop to full image (un-rotated)
    setCropRaw({ x: 0, y: 0, w: naturalWidth, h: naturalHeight });
    notifyChange();
  }, [naturalWidth, naturalHeight, notifyChange]);

  const resetAll = useCallback(() => {
    setRotationRaw(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    setAspectState(null);
    aspectRef.current = null;
    setCropRaw({ x: 0, y: 0, w: naturalWidth, h: naturalHeight });
    notifyChange();
  }, [naturalWidth, naturalHeight, notifyChange]);

  // ── Zoom ────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e) => {
      // Disabled for now — zoom is complex and will be re-enabled later
      // e.preventDefault();
    },
    [],
  );

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
