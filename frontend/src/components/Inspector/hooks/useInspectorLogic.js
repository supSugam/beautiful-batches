import { useState, useEffect, useCallback, useRef } from 'react';

const COORD_PRECISION = 100;
const quantizeCoord = (value) =>
  Math.round(value * COORD_PRECISION) / COORD_PRECISION;
const DEFAULT_PADDING = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const DEFAULT_CORNER_RADIUS = Object.freeze({
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
});
const DEFAULT_PADDING_FILL_VALUE = '#ffffff';
const MAX_PADDING_PX = 640;
const MAX_CORNER_RADIUS_PX = 360;
const INNER_PADDING_SIDE_RATIO = 0.4;
const OUTER_PADDING_SIDE_RATIO = 0.75;

const clampPaddingValue = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

const clampPaddingByMode = (padding, mode, referenceWidth, referenceHeight) => {
  const normalized = normalizePadding(padding);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const ratio = mode === 'outer' ? OUTER_PADDING_SIDE_RATIO : INNER_PADDING_SIDE_RATIO;
  const horizontalCap = Math.max(
    0,
    Math.min(MAX_PADDING_PX, Math.round(safeWidth * ratio)),
  );
  const verticalCap = Math.max(
    0,
    Math.min(MAX_PADDING_PX, Math.round(safeHeight * ratio)),
  );

  return {
    top: Math.min(normalized.top, verticalCap),
    right: Math.min(normalized.right, horizontalCap),
    bottom: Math.min(normalized.bottom, verticalCap),
    left: Math.min(normalized.left, horizontalCap),
  };
};

const clampCornerRadiusByReference = (radius, referenceWidth, referenceHeight) => {
  const normalized = normalizeCornerRadius(radius);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const maxRadius = Math.max(
    0,
    Math.min(MAX_CORNER_RADIUS_PX, Math.round(Math.min(safeWidth, safeHeight) * 0.5)),
  );

  return {
    topLeft: Math.min(normalized.topLeft, maxRadius),
    topRight: Math.min(normalized.topRight, maxRadius),
    bottomRight: Math.min(normalized.bottomRight, maxRadius),
    bottomLeft: Math.min(normalized.bottomLeft, maxRadius),
  };
};

const normalizePadding = (padding) => ({
  top: clampPaddingValue(Number(padding?.top ?? 0)),
  right: clampPaddingValue(Number(padding?.right ?? 0)),
  bottom: clampPaddingValue(Number(padding?.bottom ?? 0)),
  left: clampPaddingValue(Number(padding?.left ?? 0)),
});

const parsePaddingInput = (rawValue) => {
  const tokens = rawValue
    .trim()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return { ...DEFAULT_PADDING };
  }
  if (tokens.length > 4) {
    return null;
  }

  const values = tokens.map((token) => {
    const parsed = Number.parseFloat(token.replace(/px$/i, ''));
    if (!Number.isFinite(parsed)) return null;
    return clampPaddingValue(parsed);
  });

  if (values.some((value) => value === null)) return null;

  if (values.length === 1) {
    const [all] = values;
    return { top: all, right: all, bottom: all, left: all };
  }
  if (values.length === 2) {
    const [vertical, horizontal] = values;
    return {
      top: vertical,
      right: horizontal,
      bottom: vertical,
      left: horizontal,
    };
  }
  if (values.length === 3) {
    const [top, horizontal, bottom] = values;
    return { top, right: horizontal, bottom, left: horizontal };
  }

  const [top, right, bottom, left] = values;
  return { top, right, bottom, left };
};

const normalizeCornerRadius = (radius) => ({
  topLeft: clampPaddingValue(Number(radius?.topLeft ?? 0)),
  topRight: clampPaddingValue(Number(radius?.topRight ?? 0)),
  bottomRight: clampPaddingValue(Number(radius?.bottomRight ?? 0)),
  bottomLeft: clampPaddingValue(Number(radius?.bottomLeft ?? 0)),
});

const parseCornerRadiusInput = (rawValue) => {
  const tokens = rawValue
    .trim()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return { ...DEFAULT_CORNER_RADIUS };
  }
  if (tokens.length > 4) {
    return null;
  }

  const values = tokens.map((token) => {
    const parsed = Number.parseFloat(token.replace(/px$/i, ''));
    if (!Number.isFinite(parsed)) return null;
    return clampPaddingValue(parsed);
  });

  if (values.some((value) => value === null)) return null;

  if (values.length === 1) {
    const [all] = values;
    return {
      topLeft: all,
      topRight: all,
      bottomRight: all,
      bottomLeft: all,
    };
  }
  if (values.length === 2) {
    const [vertical, horizontal] = values;
    return {
      topLeft: vertical,
      topRight: horizontal,
      bottomRight: vertical,
      bottomLeft: horizontal,
    };
  }
  if (values.length === 3) {
    const [topLeft, horizontal, bottomRight] = values;
    return {
      topLeft,
      topRight: horizontal,
      bottomRight,
      bottomLeft: horizontal,
    };
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = values;
  return { topLeft, topRight, bottomRight, bottomLeft };
};

const formatPaddingInput = (padding) =>
  `${padding.top} ${padding.right} ${padding.bottom} ${padding.left}`;
const formatCornerRadiusInput = (radius) =>
  `${radius.topLeft} ${radius.topRight} ${radius.bottomRight} ${radius.bottomLeft}`;

const paddingEquals = (a, b) =>
  a.top === b.top &&
  a.right === b.right &&
  a.bottom === b.bottom &&
  a.left === b.left;
const cornerRadiusEquals = (a, b) =>
  a.topLeft === b.topLeft &&
  a.topRight === b.topRight &&
  a.bottomRight === b.bottomRight &&
  a.bottomLeft === b.bottomLeft;

const normalizePaddingFillType = (value) => {
  if (value === 'color' || value === 'image') return value;
  return 'empty';
};

const cloneRestoreState = (state) => {
  if (!state || typeof state !== 'object') return null;
  const coords = state.coordinates;
  const transforms = state.transforms || {};
  const flip = transforms.flip || {};
  return {
    coordinates:
      coords &&
      Number.isFinite(coords.left) &&
      Number.isFinite(coords.top) &&
      Number.isFinite(coords.width) &&
      Number.isFinite(coords.height)
        ? {
            left: coords.left,
            top: coords.top,
            width: coords.width,
            height: coords.height,
          }
        : null,
    transforms: {
      rotate: Number.isFinite(transforms.rotate) ? transforms.rotate : 0,
      flip: {
        horizontal: Boolean(flip.horizontal),
        vertical: Boolean(flip.vertical),
      },
    },
  };
};

export const useInspectorLogic = ({
  image,
  cropState,
  onCropChange,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
}) => {
  const getCenterReference = useCallback((state) => {
    const visibleArea = state?.visibleArea;
    if (
      visibleArea &&
      Number.isFinite(visibleArea.left) &&
      Number.isFinite(visibleArea.top) &&
      Number.isFinite(visibleArea.width) &&
      Number.isFinite(visibleArea.height) &&
      visibleArea.width > 0 &&
      visibleArea.height > 0
    ) {
      return visibleArea;
    }

    const imageSize = state?.imageSize;
    if (
      imageSize &&
      Number.isFinite(imageSize.width) &&
      Number.isFinite(imageSize.height) &&
      imageSize.width > 0 &&
      imageSize.height > 0
    ) {
      return {
        left: 0,
        top: 0,
        width: imageSize.width,
        height: imageSize.height,
      };
    }

    return null;
  }, []);

  // Ref to the Cropper instance (react-advanced-cropper)
  const [cropperRef, setCropperRef] = useState(null);
  const [cropperKey, setCropperKey] = useState(0); // For hard reset

  const [isProcessing, setIsProcessing] = useState(false);

  // UI State
  // We use undefined for freeform to match react-advanced-cropper, but UI passes null
  const [aspect, setAspect] = useState(undefined);
  const [outputWidth, setOutputWidth] = useState(null);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });

  // Manual Inputs
  const [manualW, setManualW] = useState('');
  const [manualH, setManualH] = useState('');
  const [manualOutputWidth, setManualOutputWidth] = useState('');
  const [paddingInput, setPaddingInput] = useState(
    formatPaddingInput(DEFAULT_PADDING),
  );
  const [paddingMode, setPaddingMode] = useState('inner');
  const [paddingValues, setPaddingValues] = useState({ ...DEFAULT_PADDING });
  const [cornerRadiusInput, setCornerRadiusInput] = useState(
    formatCornerRadiusInput(DEFAULT_CORNER_RADIUS),
  );
  const [cornerRadiusValues, setCornerRadiusValues] = useState({
    ...DEFAULT_CORNER_RADIUS,
  });
  const [paddingFillType, setPaddingFillType] = useState('empty');
  const [paddingFillValue, setPaddingFillValue] = useState(
    DEFAULT_PADDING_FILL_VALUE,
  );
  const [paddingImageUrl, setPaddingImageUrl] = useState('');

  // Stats Data
  const [cropData, setCropData] = useState({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    rotate: 0,
    imageWidth: 0,
    imageHeight: 0, // Track natural size for clamping
  });
  const [centerGuide, setCenterGuide] = useState({
    hintX: false,
    hintY: false,
    snapX: false,
    snapY: false,
  });
  const [centerStatus, setCenterStatus] = useState({
    horizontal: false,
    vertical: false,
  });
  const [isCropDragging, setIsCropDragging] = useState(false);
  const snapAxisRef = useRef({ x: false, y: false });
  const dragMetricsRef = useRef({
    prevLeft: null,
    prevTop: null,
    prevTime: 0,
    cooldownXUntil: 0,
    cooldownYUntil: 0,
  });
  const syncFrameRef = useRef(0);
  const queuedSyncRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const lastSyncedRef = useRef(null);
  const rotateFrameRef = useRef(0);
  const restoreFrameRef = useRef(0);
  const cropperReadyRef = useRef(false);
  const preparedImageIdRef = useRef(null);
  const appliedCropperStateIdRef = useRef(null);
  const restorePendingRef = useRef(false);
  const restoreSnapshotRef = useRef(null);
  const queuedRotateRef = useRef({
    delta: 0,
    options: null,
  });

  const getReferenceSize = useCallback(() => {
    const liveCoordinates = cropperRef?.getCoordinates?.();
    const width = Number(
      cropState?.coordinates?.width ??
        liveCoordinates?.width ??
        image?.naturalWidth ??
        1,
    );
    const height = Number(
      cropState?.coordinates?.height ??
        liveCoordinates?.height ??
        image?.naturalHeight ??
        1,
    );

    return {
      width: Math.max(1, Number.isFinite(width) ? width : 1),
      height: Math.max(1, Number.isFinite(height) ? height : 1),
    };
  }, [
    cropperRef,
    cropState?.coordinates?.width,
    cropState?.coordinates?.height,
    image?.naturalWidth,
    image?.naturalHeight,
  ]);

  const clampPaddingInputValues = useCallback(
    (padding, mode) => {
      const { width, height } = getReferenceSize();
      return clampPaddingByMode(padding, mode, width, height);
    },
    [getReferenceSize],
  );

  const clampCornerRadiusInputValues = useCallback(
    (radius) => {
      const { width, height } = getReferenceSize();
      return clampCornerRadiusByReference(radius, width, height);
    },
    [getReferenceSize],
  );

  // Sync Helper: Propagate current state to the store immediately
  const syncToStore = useCallback(
    (overrideAspect, snapshot) => {
      if (restorePendingRef.current) return;
      if (!cropperRef) return;
      const coords = snapshot?.coords || cropperRef.getCoordinates();
      const state = snapshot?.state || cropperRef.getState();

      // Safety Check: Don't sync if image hasn't loaded yet (ghost fix)
      // We must ensure the cropper's state matches the CURRENT image's natural dimensions.
      // If the cropper is still holding the previous image's size, we'll write invalid coords.
      const cropperW = state?.imageSize?.width;
      const cropperH = state?.imageSize?.height;
      const naturalW = image.naturalWidth;
      const naturalH = image.naturalHeight;

      if (!cropperW || !cropperH) return;

      // Check for stale data. The cropper might rotate internally, but imageSize usually reports the UNROTATED source size?
      // Actually, react-advanced-cropper imageSize is based on the loaded resource.
      // We allow a small tolerance or check if it matches either WxH or HxW.
      const matchNormal =
        Math.abs(cropperW - naturalW) < 2 && Math.abs(cropperH - naturalH) < 2;
      const matchSwapped =
        Math.abs(cropperW - naturalH) < 2 && Math.abs(cropperH - naturalW) < 2;

      if (!matchNormal && !matchSwapped) {
        // console.warn("Skipping sync: Stale image data detected");
        return;
      }

      const rotate = state?.transforms?.rotate || 0;
      const currentFlip = state?.transforms?.flip || {
        horizontal: false,
        vertical: false,
      };

      if (!coords) return;

      // Use overrideAspect if provided (for immediate UI response), otherwise use state
      const currentAspect =
        overrideAspect !== undefined ? overrideAspect : aspect;

      // Intelligent Output Width
      const autoOutputWidth =
        outputWidth ||
        (coords.width > (state?.imageSize?.width || 0) &&
        (state?.imageSize?.width || 0) > 0
          ? state.imageSize.width
          : null);

      const nextPayload = {
        coordinates: {
          left: quantizeCoord(coords.left),
          top: quantizeCoord(coords.top),
          width: quantizeCoord(coords.width),
          height: quantizeCoord(coords.height),
        },
        aspect: currentAspect,
        transforms: {
          rotate: rotate,
          flip: currentFlip,
        },
        outputWidth: autoOutputWidth,
        paddingMode,
        padding: { ...paddingValues },
        cornerRadius: { ...cornerRadiusValues },
        paddingFillType,
        paddingFillValue,
        paddingImageUrl,
        imageWidth: Math.round(state?.imageSize?.width || 0),
        imageHeight: Math.round(state?.imageSize?.height || 0),
      };

      const prevPayload = lastSyncedRef.current;
      if (
        prevPayload &&
        prevPayload.aspect === nextPayload.aspect &&
        prevPayload.outputWidth === nextPayload.outputWidth &&
        prevPayload.imageWidth === nextPayload.imageWidth &&
        prevPayload.imageHeight === nextPayload.imageHeight &&
        prevPayload.transforms.rotate === nextPayload.transforms.rotate &&
        prevPayload.transforms.flip.horizontal ===
          nextPayload.transforms.flip.horizontal &&
        prevPayload.transforms.flip.vertical ===
          nextPayload.transforms.flip.vertical &&
        prevPayload.coordinates.left === nextPayload.coordinates.left &&
        prevPayload.coordinates.top === nextPayload.coordinates.top &&
        prevPayload.coordinates.width === nextPayload.coordinates.width &&
        prevPayload.coordinates.height === nextPayload.coordinates.height &&
        prevPayload.paddingMode === nextPayload.paddingMode &&
        prevPayload.padding?.top === nextPayload.padding.top &&
        prevPayload.padding?.right === nextPayload.padding.right &&
        prevPayload.padding?.bottom === nextPayload.padding.bottom &&
        prevPayload.padding?.left === nextPayload.padding.left &&
        prevPayload.cornerRadius?.topLeft === nextPayload.cornerRadius.topLeft &&
        prevPayload.cornerRadius?.topRight === nextPayload.cornerRadius.topRight &&
        prevPayload.cornerRadius?.bottomRight ===
          nextPayload.cornerRadius.bottomRight &&
        prevPayload.cornerRadius?.bottomLeft ===
          nextPayload.cornerRadius.bottomLeft &&
        prevPayload.paddingFillType === nextPayload.paddingFillType &&
        prevPayload.paddingFillValue === nextPayload.paddingFillValue &&
        prevPayload.paddingImageUrl === nextPayload.paddingImageUrl
      ) {
        return;
      }

      lastSyncedRef.current = nextPayload;
      onCropChange(image.id, nextPayload);
    },
    [
      cropperRef,
      image.id,
      onCropChange,
      aspect,
      outputWidth,
      paddingMode,
      paddingValues,
      cornerRadiusValues,
      paddingFillType,
      paddingFillValue,
      paddingImageUrl,
    ],
  );

  // Throttle sync writes to once per animation frame to avoid drag-time jank.
  const scheduleSyncToStore = useCallback(
    (snapshot, overrideAspect) => {
      queuedSyncRef.current = { snapshot, overrideAspect };
      if (syncFrameRef.current) return;

      syncFrameRef.current = requestAnimationFrame(() => {
        syncFrameRef.current = 0;
        const next = queuedSyncRef.current;
        queuedSyncRef.current = null;
        if (!next) return;
        syncToStore(next.overrideAspect, next.snapshot);
      });
    },
    [syncToStore],
  );

  const flushQueuedSyncToStore = useCallback(() => {
    if (syncFrameRef.current) {
      cancelAnimationFrame(syncFrameRef.current);
      syncFrameRef.current = 0;
    }

    const queued = queuedSyncRef.current;
    queuedSyncRef.current = null;
    if (queued) {
      syncToStore(queued.overrideAspect, queued.snapshot);
      return;
    }

    if (latestSnapshotRef.current) {
      syncToStore(undefined, latestSnapshotRef.current);
      return;
    }

    syncToStore();
  }, [syncToStore]);

  const applyQueuedRotateDelta = useCallback(() => {
    if (!cropperRef) {
      queuedRotateRef.current = { delta: 0, options: null };
      return;
    }

    const { delta, options } = queuedRotateRef.current;
    queuedRotateRef.current = { delta: 0, options: null };
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

    if (options) {
      cropperRef.rotateImage(delta, options);
    } else {
      cropperRef.rotateImage(delta);
    }
  }, [cropperRef]);

  const scheduleRotateDelta = useCallback(
    (delta, options) => {
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

      queuedRotateRef.current.delta += delta;
      if (options) {
        queuedRotateRef.current.options = options;
      }
      if (rotateFrameRef.current) return;

      rotateFrameRef.current = requestAnimationFrame(() => {
        rotateFrameRef.current = 0;
        applyQueuedRotateDelta();
      });
    },
    [applyQueuedRotateDelta],
  );

  const flushRotateDelta = useCallback(() => {
    if (rotateFrameRef.current) {
      cancelAnimationFrame(rotateFrameRef.current);
      rotateFrameRef.current = 0;
    }
    applyQueuedRotateDelta();
  }, [applyQueuedRotateDelta]);

  const applyPersistedStateToCropper = useCallback(() => {
    if (!cropperRef) return false;
    if (appliedCropperStateIdRef.current === image.id) return true;

    const isLoaded =
      typeof cropperRef.isLoaded === 'function' ? cropperRef.isLoaded() : true;
    const state = cropperRef.getState?.();
    const cropperW = Number(state?.imageSize?.width || 0);
    const cropperH = Number(state?.imageSize?.height || 0);
    const naturalW = Number(image?.naturalWidth || 0);
    const naturalH = Number(image?.naturalHeight || 0);
    const hasValidSize = cropperW > 0 && cropperH > 0;
    const matchNormal =
      naturalW > 0 &&
      naturalH > 0 &&
      Math.abs(cropperW - naturalW) < 2 &&
      Math.abs(cropperH - naturalH) < 2;
    const matchSwapped =
      naturalW > 0 &&
      naturalH > 0 &&
      Math.abs(cropperW - naturalH) < 2 &&
      Math.abs(cropperH - naturalW) < 2;

    if (!isLoaded || !hasValidSize || (!matchNormal && !matchSwapped)) {
      return false;
    }

    const restoreState = restoreSnapshotRef.current;
    if (restoreState) {
      const rotate = restoreState.transforms?.rotate || 0;
      const flipState = restoreState.transforms?.flip || {
        horizontal: false,
        vertical: false,
      };

      cropperRef.reset();
      if (rotate) {
        cropperRef.rotateImage(rotate, {
          transitions: false,
          interaction: false,
          immediately: true,
        });
      }
      if (flipState.horizontal) {
        cropperRef.flipImage(true, false, {
          transitions: false,
          interaction: false,
          immediately: true,
        });
      }
      if (flipState.vertical) {
        cropperRef.flipImage(false, true, {
          transitions: false,
          interaction: false,
          immediately: true,
        });
      }
      if (restoreState.coordinates) {
        cropperRef.setCoordinates(
          {
            left: restoreState.coordinates.left,
            top: restoreState.coordinates.top,
            width: restoreState.coordinates.width,
            height: restoreState.coordinates.height,
          },
          {
            transitions: false,
            immediately: true,
          },
        );
      }
      cropperRef.transformImageEnd?.({
        transitions: false,
        immediately: true,
      });
    } else {
      cropperRef.reset();
    }

    appliedCropperStateIdRef.current = image.id;
    restorePendingRef.current = false;
    requestAnimationFrame(() => syncToStore());
    return true;
  }, [
    cropperRef,
    image.id,
    image?.naturalHeight,
    image?.naturalWidth,
    syncToStore,
  ]);

  const handleCropperReady = useCallback(() => {
    cropperReadyRef.current = true;
    if (restoreFrameRef.current) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = 0;
    }
    applyPersistedStateToCropper();
  }, [applyPersistedStateToCropper]);

  const handleCropperInit = useCallback((instance) => {
    setCropperRef(instance);
    cropperReadyRef.current = Boolean(instance?.isLoaded?.());
  }, []);

  // Callback whenever cropper changes (move, zoom, rotate)
  const onCropperChange = useCallback(
    (cropper) => {
      if (!cropper) return;
      if (restorePendingRef.current) return;
      const coords = cropper.getCoordinates();

      if (coords) {
        const state = cropper.getState && cropper.getState();
        latestSnapshotRef.current = { coords, state };
        const rotate = state?.transforms?.rotate || 0;
        const imageSize = state?.imageSize || { width: 0, height: 0 };
        const centerRef = getCenterReference(state);
        if (!centerRef) return;
        const isMoveGesture = isCropDragging;
        const now =
          typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        const moveDx =
          dragMetricsRef.current.prevLeft === null
            ? 0
            : coords.left - dragMetricsRef.current.prevLeft;
        const moveDy =
          dragMetricsRef.current.prevTop === null
            ? 0
            : coords.top - dragMetricsRef.current.prevTop;
        const absMoveX = Math.abs(moveDx);
        const absMoveY = Math.abs(moveDy);
        const cropCenterX = coords.left + coords.width / 2;
        const cropCenterY = coords.top + coords.height / 2;
        const imageCenterX = centerRef.left + centerRef.width / 2;
        const imageCenterY = centerRef.top + centerRef.height / 2;
        const offsetX = cropCenterX - imageCenterX;
        const offsetY = cropCenterY - imageCenterY;
        const deltaX = Math.abs(cropCenterX - imageCenterX);
        const deltaY = Math.abs(cropCenterY - imageCenterY);
        const guideBase = Math.min(centerRef.width, centerRef.height);
        const hintThreshold = Math.max(9, Math.min(20, guideBase * 0.018));
        const snapThreshold = Math.max(4, Math.min(11, guideBase * 0.009));
        const releaseThreshold = Math.max(
          snapThreshold + 0.75,
          snapThreshold * 1.35,
        );
        const centerStatusThreshold = Math.max(
          2.5,
          Math.min(centerRef.width, centerRef.height) * 0.004,
        );
        const minBreakMove = 0.1;
        const cooldownMs = 70;
        const targetLeft = imageCenterX - coords.width / 2;
        const targetTop = imageCenterY - coords.height / 2;

        // Hysteresis: easy enter, easier exit, short cooldown to avoid sticky re-catching.
        if (
          snapAxisRef.current.x &&
          deltaX > releaseThreshold &&
          absMoveX > minBreakMove &&
          Math.sign(moveDx || 0) === Math.sign(offsetX || 0)
        ) {
          snapAxisRef.current.x = false;
          dragMetricsRef.current.cooldownXUntil = now + cooldownMs;
        }
        if (
          snapAxisRef.current.y &&
          deltaY > releaseThreshold &&
          absMoveY > minBreakMove &&
          Math.sign(moveDy || 0) === Math.sign(offsetY || 0)
        ) {
          snapAxisRef.current.y = false;
          dragMetricsRef.current.cooldownYUntil = now + cooldownMs;
        }

        const canSnapX = now >= dragMetricsRef.current.cooldownXUntil;
        const canSnapY = now >= dragMetricsRef.current.cooldownYUntil;
        const shouldHintX =
          isMoveGesture &&
          deltaX <= hintThreshold &&
          !snapAxisRef.current.x;
        const shouldHintY =
          isMoveGesture &&
          deltaY <= hintThreshold &&
          !snapAxisRef.current.y;
        const shouldSnapX =
          isMoveGesture &&
          !snapAxisRef.current.x &&
          canSnapX &&
          deltaX <= snapThreshold;
        const shouldSnapY =
          isMoveGesture &&
          !snapAxisRef.current.y &&
          canSnapY &&
          deltaY <= snapThreshold;

        if (shouldSnapX || shouldSnapY) {
          const snappedLeft = shouldSnapX ? targetLeft : coords.left;
          const snappedTop = shouldSnapY ? targetTop : coords.top;
          if (
            Math.abs(snappedLeft - coords.left) > 0.01 ||
            Math.abs(snappedTop - coords.top) > 0.01
          ) {
            cropper.setCoordinates({
              left: snappedLeft,
              top: snappedTop,
            });
            snapAxisRef.current = {
              x: snapAxisRef.current.x || shouldSnapX,
              y: snapAxisRef.current.y || shouldSnapY,
            };
            setCenterGuide({
              hintX: false,
              hintY: false,
              snapX: snapAxisRef.current.x,
              snapY: snapAxisRef.current.y,
            });
            dragMetricsRef.current.prevLeft = snappedLeft;
            dragMetricsRef.current.prevTop = snappedTop;
            dragMetricsRef.current.prevTime = now;
            setCenterStatus({
              horizontal:
                Math.abs(snappedLeft + coords.width / 2 - imageCenterX) <=
                centerStatusThreshold,
              vertical:
                Math.abs(snappedTop + coords.height / 2 - imageCenterY) <=
                centerStatusThreshold,
            });
            scheduleSyncToStore(
              {
                coords: {
                  ...coords,
                  left: snappedLeft,
                  top: snappedTop,
                },
                state,
              },
              undefined,
            );
            return;
          }
        }

        setCenterGuide((prev) => {
          const next = {
            hintX: shouldHintX && !snapAxisRef.current.x,
            hintY: shouldHintY && !snapAxisRef.current.y,
            snapX: isMoveGesture && snapAxisRef.current.x,
            snapY: isMoveGesture && snapAxisRef.current.y,
          };
          if (
            prev.hintX === next.hintX &&
            prev.hintY === next.hintY &&
            prev.snapX === next.snapX &&
            prev.snapY === next.snapY
          ) {
            return prev;
          }
          return next;
        });

        const newCropData = {
          width: Math.round(coords.width),
          height: Math.round(coords.height),
          x: Math.round(coords.left),
          y: Math.round(coords.top),
          rotate: rotate,
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
        };

        setCropData((prev) => {
          if (
            prev.width === newCropData.width &&
            prev.height === newCropData.height &&
            prev.x === newCropData.x &&
            prev.y === newCropData.y &&
            prev.rotate === newCropData.rotate &&
            prev.imageWidth === newCropData.imageWidth &&
            prev.imageHeight === newCropData.imageHeight
          ) {
            return prev;
          }
          return newCropData;
        });

        // Trigger throttled sync to store for "Live Crop Preview"
        scheduleSyncToStore({ coords, state }, undefined);
        dragMetricsRef.current.prevLeft = coords.left;
        dragMetricsRef.current.prevTop = coords.top;
        dragMetricsRef.current.prevTime = now;
        setCenterStatus((prev) => {
          const next = {
            horizontal: deltaX <= centerStatusThreshold,
            vertical: deltaY <= centerStatusThreshold,
          };
          if (
            prev.horizontal === next.horizontal &&
            prev.vertical === next.vertical
          ) {
            return prev;
          }
          return next;
        });
      }
    },
    [getCenterReference, isCropDragging, scheduleSyncToStore],
  );

  // We use a ref to track the CURRENT sync function because we need to call it in cleanup
  // but we don't want the cleanup to re-run constantly if syncToStore changes identity (it shouldn't much, but still).
  const syncRef = useRef(syncToStore);
  useEffect(() => {
    syncRef.current = syncToStore;
  }, [syncToStore]);

  useEffect(
    () => () => {
      if (syncFrameRef.current) {
        cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = 0;
      }
      if (rotateFrameRef.current) {
        cancelAnimationFrame(rotateFrameRef.current);
        rotateFrameRef.current = 0;
      }
      if (restoreFrameRef.current) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = 0;
      }
      queuedSyncRef.current = null;
      queuedRotateRef.current = { delta: 0, options: null };
    },
    [],
  );

  useEffect(() => {
    lastSyncedRef.current = null;
  }, [image.id]);

  // Save state before switching images
  // REMOVED: This was causing a race condition where the new image's default state
  // was being saved to the old image's ID during the render cycle.
  // Since we sync immediately on all changes, this explicit save is unnecessary and dangerous.

  useEffect(() => {
    // This cleanup runs on unmount of the component or if cropperRef itself changes (e.g., becomes null)
    return () => {
      if (cropperRef) {
        // ensuring we capture the final state if component unmounts
        syncRef.current();
      }
    };
  }, [cropperRef]);

  useEffect(() => {
    if (preparedImageIdRef.current === image.id) return;

    if (cropState) {
      const nextMode = cropState.paddingMode === 'outer' ? 'outer' : 'inner';
      const nextPadding = clampPaddingInputValues(cropState.padding, nextMode);
      const nextCornerRadius = clampCornerRadiusInputValues(
        cropState.cornerRadius,
      );
      const nextFlip = cropState.transforms?.flip || {
        horizontal: false,
        vertical: false,
      };

      setAspect(cropState.aspect || undefined);
      setFlip(nextFlip);
      if (cropState.outputWidth) setOutputWidth(cropState.outputWidth);
      else setOutputWidth(null);
      setPaddingMode(nextMode);
      setPaddingValues(nextPadding);
      setPaddingInput(formatPaddingInput(nextPadding));
      setCornerRadiusValues(nextCornerRadius);
      setCornerRadiusInput(formatCornerRadiusInput(nextCornerRadius));
      setPaddingFillType(normalizePaddingFillType(cropState.paddingFillType));
      setPaddingFillValue(
        typeof cropState.paddingFillValue === 'string' &&
          cropState.paddingFillValue.trim() !== ''
          ? cropState.paddingFillValue
          : DEFAULT_PADDING_FILL_VALUE,
      );
      setPaddingImageUrl(
        typeof cropState.paddingImageUrl === 'string'
          ? cropState.paddingImageUrl
          : '',
      );
    } else {
      setAspect(undefined);
      setFlip({ horizontal: false, vertical: false });
      setOutputWidth(null);
      setPaddingMode('inner');
      setPaddingValues({ ...DEFAULT_PADDING });
      setPaddingInput(formatPaddingInput(DEFAULT_PADDING));
      setCornerRadiusValues({ ...DEFAULT_CORNER_RADIUS });
      setCornerRadiusInput(formatCornerRadiusInput(DEFAULT_CORNER_RADIUS));
      setPaddingFillType('empty');
      setPaddingFillValue(DEFAULT_PADDING_FILL_VALUE);
      setPaddingImageUrl('');
    }

    preparedImageIdRef.current = image.id;
    appliedCropperStateIdRef.current = null;
    latestSnapshotRef.current = null;
    restoreSnapshotRef.current = cloneRestoreState(cropState);
    restorePendingRef.current = Boolean(restoreSnapshotRef.current);
    cropperReadyRef.current = false;
    setManualW('');
    setManualH('');
    setManualOutputWidth('');
    setIsCropDragging(false);
    snapAxisRef.current = { x: false, y: false };
    dragMetricsRef.current = {
      prevLeft: null,
      prevTop: null,
      prevTime: 0,
      cooldownXUntil: 0,
      cooldownYUntil: 0,
    };
    setCenterGuide({
      hintX: false,
      hintY: false,
      snapX: false,
      snapY: false,
    });
    setCenterStatus({
      horizontal: false,
      vertical: false,
    });
  }, [
    image.id,
    cropState,
    clampPaddingInputValues,
    clampCornerRadiusInputValues,
  ]);

  useEffect(() => {
    if (!cropperRef) return;
    if (appliedCropperStateIdRef.current === image.id) return;

    let attempts = 0;
    const maxAttempts = 60;

    const attemptApply = () => {
      if (applyPersistedStateToCropper()) return;
      attempts += 1;
      if (attempts >= maxAttempts) {
        restorePendingRef.current = false;
        return;
      }
      restoreFrameRef.current = requestAnimationFrame(attemptApply);
    };

    if (restoreFrameRef.current) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = 0;
    }

    attemptApply();

    return () => {
      if (restoreFrameRef.current) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = 0;
      }
    };
  }, [cropperRef, image.id, applyPersistedStateToCropper]);

  // Guarantee last edit state is committed before switching to another image.
  useEffect(
    () => () => {
      flushRotateDelta();
      flushQueuedSyncToStore();
    },
    [image.id, flushRotateDelta, flushQueuedSyncToStore],
  );

  const navigateNext = useCallback(() => {
    if (hasNext) {
      flushRotateDelta();
      flushQueuedSyncToStore();
      onNext();
    }
  }, [hasNext, flushRotateDelta, flushQueuedSyncToStore, onNext]);

  const navigatePrev = useCallback(() => {
    if (hasPrev) {
      flushRotateDelta();
      flushQueuedSyncToStore();
      onPrev();
    }
  }, [hasPrev, flushRotateDelta, flushQueuedSyncToStore, onPrev]);

  const handleClose = useCallback(() => {
    flushRotateDelta();
    flushQueuedSyncToStore();
    onClose();
  }, [flushRotateDelta, flushQueuedSyncToStore, onClose]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
        return;
      if (e.key === 'ArrowLeft') navigatePrev();
      if (e.key === 'ArrowRight') navigateNext();
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateNext, navigatePrev, handleClose]);

  // Sync when aspect, flip, outputWidth, padding, or cropper instance resets
  useEffect(() => {
    if (cropperRef) {
      syncToStore();
    }
  }, [
    aspect,
    flip,
    outputWidth,
    paddingValues,
    cornerRadiusValues,
    paddingMode,
    paddingFillType,
    paddingFillValue,
    paddingImageUrl,
    cropperKey,
    syncToStore,
  ]); // syncToStore already checks isReady

  // Actions
  const handleRotate = () => {
    if (cropperRef) {
      flushRotateDelta();
      cropperRef.rotateImage(90);
      // Removed manual syncToStore, the effect above or onCropperChange will handle it
    }
  };

  // For Slider
  const handleRotateDelta = (delta, options) => {
    if (!cropperRef) return;
    scheduleRotateDelta(delta, options);
  };

  const handleRotateEnd = () => {
    if (!cropperRef) return;
    flushRotateDelta();
    cropperRef.transformImageEnd();
    requestAnimationFrame(() => syncToStore());
  };

  const handleFlip = (horizontal) => {
    if (!cropperRef) return;
    flushRotateDelta();
    if (horizontal) {
      cropperRef.flipImage(true, false);
    } else {
      cropperRef.flipImage(false, true);
    }

    setFlip((prev) => ({
      ...prev,
      [horizontal ? 'horizontal' : 'vertical']:
        !prev[horizontal ? 'horizontal' : 'vertical'],
    }));
  };

  const handleResetTransforms = () => {
    if (!cropperRef) return;
    flushRotateDelta();

    const state = cropperRef.getState?.();
    const rotate = state?.transforms?.rotate || 0;
    const currentFlip = state?.transforms?.flip || {
      horizontal: false,
      vertical: false,
    };

    if (Number.isFinite(rotate) && Math.abs(rotate) > 0.0001) {
      cropperRef.rotateImage(-rotate, {
        transitions: false,
        interaction: false,
        immediately: true,
      });
    }
    if (currentFlip.horizontal) {
      cropperRef.flipImage(true, false);
    }
    if (currentFlip.vertical) {
      cropperRef.flipImage(false, true);
    }

    cropperRef.transformImageEnd();
    setFlip({ horizontal: false, vertical: false });
    requestAnimationFrame(() => syncToStore());
  };

  const handleResetDraft = () => {
    if (rotateFrameRef.current) {
      cancelAnimationFrame(rotateFrameRef.current);
      rotateFrameRef.current = 0;
    }
    queuedRotateRef.current = { delta: 0, options: null };
    restoreSnapshotRef.current = null;
    restorePendingRef.current = false;
    setCropperKey((prev) => prev + 1);
    setAspect(undefined);
    setFlip({ horizontal: false, vertical: false });
    setOutputWidth(null);
    setPaddingMode('inner');
    setPaddingValues({ ...DEFAULT_PADDING });
    setPaddingInput(formatPaddingInput(DEFAULT_PADDING));
    setCornerRadiusValues({ ...DEFAULT_CORNER_RADIUS });
    setCornerRadiusInput(formatCornerRadiusInput(DEFAULT_CORNER_RADIUS));
    setPaddingFillType('empty');
    setPaddingFillValue(DEFAULT_PADDING_FILL_VALUE);
    setPaddingImageUrl('');
    setManualW('');
    setManualH('');
    setManualOutputWidth('');
  };

  const handleAspectClick = useCallback(
    (val) => {
      const newAspect = val === null ? undefined : val;
      if (newAspect === undefined && aspect === undefined && cropperRef) {
        cropperRef.setCoordinates({
          left: -99999,
          top: -99999,
          width: 999999,
          height: 999999,
        });
      }
      setAspect(newAspect);
    },
    [aspect, cropperRef],
  );

  const handleLockToggle = () => {
    if (!cropperRef) return;
    if (aspect === undefined) {
      const coords = cropperRef.getCoordinates();
      if (coords) {
        setAspect(coords.width / coords.height);
      }
    } else {
      setAspect(undefined);
    }
  };

  const handleCenterCrop = useCallback(() => {
    if (!cropperRef) return;
    const coords = cropperRef.getCoordinates();
    const state = cropperRef.getState && cropperRef.getState();
    const centerRef = getCenterReference(state);
    if (!coords || !centerRef) return;

    const left = centerRef.left + (centerRef.width - coords.width) / 2;
    const top = centerRef.top + (centerRef.height - coords.height) / 2;

    cropperRef.setCoordinates({
      left,
      top,
    });
    setCenterStatus({
      horizontal: true,
      vertical: true,
    });
  }, [cropperRef, getCenterReference]);

  const handleSelectionDimChange = (dim, val) => {
    if (dim === 'w') setManualW(val);
    else setManualH(val);
    if (!val || isNaN(parseInt(val)) || !cropperRef) return;
    const num = parseInt(val);

    const coords = cropperRef.getCoordinates();
    if (!coords) return;

    let newCoords = { ...coords };
    if (dim === 'w') {
      newCoords.width = num;
      if (aspect) newCoords.height = num / aspect;
    } else {
      newCoords.height = num;
      if (aspect) newCoords.width = num * aspect;
    }

    cropperRef.setCoordinates(newCoords);
  };

  const handleDimBlur = () => {
    setManualW('');
    setManualH('');
  };

  const handleResizeToggle = () => {
    setOutputWidth((prev) => (prev ? null : 1024));
    setManualOutputWidth('');
  };

  const handleOutputWidthChange = (val) => {
    setManualOutputWidth(val);
    const num = parseInt(val);
    if (!isNaN(num)) {
      setOutputWidth(num);
    }
  };

  const handleOutputWidthBlur = () => {
    setManualOutputWidth('');
  };

  const handlePaddingInputChange = (value) => {
    setPaddingInput(value);
    const parsed = parsePaddingInput(value);
    if (!parsed) return;
    const clamped = clampPaddingInputValues(parsed, paddingMode);
    setPaddingValues((prev) => (paddingEquals(prev, clamped) ? prev : clamped));
  };

  const handlePaddingInputBlur = () => {
    setPaddingInput(formatPaddingInput(paddingValues));
  };

  const handlePaddingModeChange = (mode) => {
    const nextMode = mode === 'outer' ? 'outer' : 'inner';
    setPaddingMode(nextMode);
    const clamped = clampPaddingInputValues(paddingValues, nextMode);
    setPaddingValues((prev) => (paddingEquals(prev, clamped) ? prev : clamped));
    setPaddingInput(formatPaddingInput(clamped));
  };

  const handleCornerRadiusInputChange = (value) => {
    setCornerRadiusInput(value);
    const parsed = parseCornerRadiusInput(value);
    if (!parsed) return;
    const clamped = clampCornerRadiusInputValues(parsed);
    setCornerRadiusValues((prev) =>
      cornerRadiusEquals(prev, clamped) ? prev : clamped,
    );
  };

  const handleCornerRadiusInputBlur = () => {
    setCornerRadiusInput(formatCornerRadiusInput(cornerRadiusValues));
  };

  const handlePaddingFillTypeChange = (type) => {
    setPaddingFillType(normalizePaddingFillType(type));
  };

  const handlePaddingFillValueChange = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    setPaddingFillValue(value);
  };

  const handlePaddingImageFileChange = (file) => {
    if (!file) {
      setPaddingImageUrl('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextValue = typeof reader.result === 'string' ? reader.result : '';
      setPaddingImageUrl(nextValue);
      if (nextValue) {
        setPaddingFillType('image');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCropDragStart = useCallback((mode = 'unknown') => {
    setIsCropDragging(mode === 'move');
    snapAxisRef.current = { x: false, y: false };
    dragMetricsRef.current = {
      prevLeft: null,
      prevTop: null,
      prevTime: 0,
      cooldownXUntil: 0,
      cooldownYUntil: 0,
    };
    if (mode !== 'move') {
      setCenterGuide({
        hintX: false,
        hintY: false,
        snapX: false,
        snapY: false,
      });
    }
  }, []);

  const handleCropDragEnd = useCallback(() => {
    flushRotateDelta();
    flushQueuedSyncToStore();
    setIsCropDragging(false);
    snapAxisRef.current = { x: false, y: false };
    dragMetricsRef.current = {
      prevLeft: null,
      prevTop: null,
      prevTime: 0,
      cooldownXUntil: 0,
      cooldownYUntil: 0,
    };
    setCenterGuide({
      hintX: false,
      hintY: false,
      snapX: false,
      snapY: false,
    });
  }, [flushQueuedSyncToStore, flushRotateDelta]);

  useEffect(() => {
    if (!isCropDragging) return undefined;
    const stopDrag = () => {
      setIsCropDragging(false);
      snapAxisRef.current = { x: false, y: false };
      dragMetricsRef.current = {
        prevLeft: null,
        prevTop: null,
        prevTime: 0,
        cooldownXUntil: 0,
        cooldownYUntil: 0,
      };
      setCenterGuide({
        hintX: false,
        hintY: false,
        snapX: false,
        snapY: false,
      });
    };
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [isCropDragging]);

  // Visual Dims
  const isSideways = cropData.rotate % 180 !== 0;
  const rawW = isSideways ? cropData.height : cropData.width;
  const rawH = isSideways ? cropData.width : cropData.height;
  const natW = isSideways ? cropData.imageHeight : cropData.imageWidth;
  const natH = isSideways ? cropData.imageWidth : cropData.imageHeight;

  let visualW = rawW;
  let visualH = rawH;

  if (natW > 0 && rawW > natW) {
    visualW = natW;
    visualH = Math.round(rawH * (natW / rawW));
  }

  return {
    onCropperInit: handleCropperInit,
    onCropperReady: handleCropperReady,
    onCropperChange,
    centerGuide,
    centerStatus,
    handleCropDragStart,
    handleCropDragEnd,
    isProcessing,

    // Stats
    currentPixelWidth: visualW,
    currentPixelHeight: visualH,
    logicalW: visualW,
    logicalH: visualH,
    rotation: cropData.rotate,

    // Controls
    aspect: aspect === undefined ? null : aspect,
    flip,
    outputWidth,
    paddingMode,
    paddingInput,
    cornerRadiusInput,
    paddingFillType,
    paddingFillValue,
    paddingImageUrl,

    manualW,
    manualH,
    manualOutputWidth,

    // Handlers
    handleRotate,
    handleRotateDelta,
    handleRotateEnd,
    handleFlip,
    handleResetTransforms,
    handleResetDraft,
    handleAspectClick,
    handleCenterCrop,
    handleLockToggle,
    handleSelectionDimChange,
    handleDimBlur,
    handleResizeToggle,
    handleOutputWidthChange,
    handleOutputWidthBlur,
    handlePaddingInputChange,
    handlePaddingInputBlur,
    handlePaddingModeChange,
    handleCornerRadiusInputChange,
    handleCornerRadiusInputBlur,
    handlePaddingFillTypeChange,
    handlePaddingFillValueChange,
    handlePaddingImageFileChange,

    handleClose,
    navigateNext,
    navigatePrev,

    // Key for hard reset
    cropperKey,

    // Stubs
    onImageLoad: () => {},
    visualUrl: null,
  };
};
