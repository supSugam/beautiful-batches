import { useState, useEffect, useCallback, useRef } from 'react';

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
  // Ref to the Cropper instance (react-advanced-cropper)
  const [cropperRef, setCropperRef] = useState(null);
  const [cropperKey, setCropperKey] = useState(0); // For hard reset

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // UI State
  // We use undefined for freeform to match react-advanced-cropper, but UI passes null
  const [aspect, setAspect] = useState(undefined);
  const [outputWidth, setOutputWidth] = useState(null);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });

  // Manual Inputs
  const [manualW, setManualW] = useState('');
  const [manualH, setManualH] = useState('');
  const [manualOutputWidth, setManualOutputWidth] = useState('');

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

  // Callback whenever cropper changes (move, zoom, rotate)
  const onCropperChange = useCallback((cropper) => {
    if (!cropper) return;
    const coords = cropper.getCoordinates(); // { left, top, width, height } relative to original image
    // Note: react-advanced-cropper coordinates are usually ideal.

    // Get transforms if needed for rotation stat?
    // cropper.getState() -> { transforms: { rotate, flip... } }
    // Actually `cropper.getState()` might be internal.
    // Usually passed in `onChange` event object? No, the arg IS the cropper instance proxy.

    // Let's assume basic coords access first.
    if (coords) {
      const state = cropper.getState && cropper.getState();
      const rotate = state?.transforms?.rotate || 0;
      const imageSize = state?.imageSize || { width: 0, height: 0 };

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

      setIsDirty((prev) => (prev ? prev : true));
      setSaved((prev) => (prev ? false : prev));
    }
  }, []);

  // Initial Sync
  const lastId = useRef(null);
  useEffect(() => {
    if (lastId.current !== image.id) {
      // New image.
      // Reset internal state.
      // Cropper ref usually stays, but component might remount or reset source.

      if (cropState) {
        const { rotate, flip: flipState } = cropState.transforms || {};

        // Restore settings
        setAspect(cropState.aspect || undefined);
        if (flipState) setFlip(flipState);
        else setFlip({ horizontal: false, vertical: false });

        if (cropState.outputWidth) setOutputWidth(cropState.outputWidth);
        else setOutputWidth(null);

        // We need to tell Cropper to set these.
        if (cropperRef) {
          // Reset first?
          cropperRef.reset();

          // Apply transforms
          // For flip, we need to be careful. react-advanced-cropper accumulates flips?
          // Safer to set absolute state if possible, but the API is imperative.
          // We will rely on resetting then applying.
          if (rotate) cropperRef.rotateImage(rotate);
          if (flipState) {
            if (flipState.horizontal) cropperRef.flipImage(true, false);
            if (flipState.vertical) cropperRef.flipImage(false, true);
          }

          // Apply coords
          if (cropState.coordinates) {
            cropperRef.setCoordinates({
              left: cropState.coordinates.left,
              top: cropState.coordinates.top,
              width: cropState.coordinates.width,
              height: cropState.coordinates.height,
            });
          }
        }
      } else {
        setAspect(undefined);
        setFlip({ horizontal: false, vertical: false });
        setOutputWidth(null);
        // Default to full image if no state
        if (cropperRef) {
          cropperRef.reset();
          // Force full selection?
          // defaultSize prop on component handles initial, but for reset we might need manual
        }
      }

      setIsDirty(false);
      setSaved(false);
      lastId.current = image.id;
      setManualW('');
      setManualH('');
      setManualOutputWidth('');
    }
  }, [image.id, cropState, cropperRef]);

  // Save
  const handleSave = useCallback(() => {
    if (!cropperRef) return;
    const coords = cropperRef.getCoordinates();
    const state = cropperRef.getState();
    const rotate = state?.transforms?.rotate || 0;
    const currentFlip = state?.transforms?.flip || {
      horizontal: false,
      vertical: false,
    };

    if (!coords) return;

    // Intelligent Output Width:
    // If zoomed out (crop width > image width), clamp output width to image width (padding effect)
    // unless user manually set outputWidth.
    const autoOutputWidth =
      outputWidth ||
      (coords.width > (state?.imageSize?.width || 0) &&
      (state?.imageSize?.width || 0) > 0
        ? state.imageSize.width
        : null);

    onCropChange(image.id, {
      coordinates: {
        left: Math.round(coords.left),
        top: Math.round(coords.top),
        width: Math.round(coords.width),
        height: Math.round(coords.height),
      },
      aspect: aspect,
      transforms: {
        rotate: rotate,
        flip: currentFlip,
      },
      outputWidth: autoOutputWidth,
    });

    setIsDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [cropperRef, image.id, onCropChange, aspect, outputWidth]);

  const navigateNext = useCallback(() => {
    if (hasNext) {
      if (isDirty) handleSave();
      onNext();
    }
  }, [hasNext, isDirty, handleSave, onNext]);
  const navigatePrev = useCallback(() => {
    if (hasPrev) {
      if (isDirty) handleSave();
      onPrev();
    }
  }, [hasPrev, isDirty, handleSave, onPrev]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
        return;
      if (e.key === 'ArrowLeft') navigatePrev();
      if (e.key === 'ArrowRight') navigateNext();
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateNext, navigatePrev, handleSave]);

  // Actions
  const handleRotate = () => {
    if (cropperRef) {
      cropperRef.rotateImage(90);
    }
  };

  // For Slider
  const handleRotateDelta = (delta, options) => {
    if (cropperRef) {
      cropperRef.rotateImage(delta, options);
    }
  };

  const handleRotateEnd = () => {
    if (cropperRef) {
      cropperRef.transformImageEnd();
    }
  };

  const handleFlip = (horizontal) => {
    if (!cropperRef) return;
    // react-advanced-cropper flipImage(h, v) toggles that axis.
    // So passed true for the axis we want to toggle.
    if (horizontal) {
      cropperRef.flipImage(true, false);
    } else {
      cropperRef.flipImage(false, true);
    }

    // We also update local state for the UI button highlight
    setFlip((prev) => ({
      ...prev,
      [horizontal ? 'horizontal' : 'vertical']:
        !prev[horizontal ? 'horizontal' : 'vertical'],
    }));
  };

  const handleResetDraft = () => {
    // Hard reset: Force component remount
    setCropperKey((prev) => prev + 1);

    setAspect(undefined);
    setFlip({ horizontal: false, vertical: false });
    setOutputWidth(null);
    setManualW('');
    setManualH('');
    setManualOutputWidth('');
  };

  const handleAspectClick = (val) => {
    // Map null (from UI) to undefined (for Logic/Library)
    const newAspect = val === null ? undefined : val;

    // If clicking Freeform again, reset selection to full image
    if (newAspect === undefined && aspect === undefined && cropperRef) {
      const state = cropperRef.getState();
      if (state && state.imageSize) {
        cropperRef.setCoordinates({
          left: 0,
          top: 0,
          width: state.imageSize.width,
          height: state.imageSize.height,
        });
      }
    }

    setAspect(newAspect);
  };

  const handleLockToggle = () => {
    if (!cropperRef) return;
    if (aspect === undefined) {
      // Lock current
      const coords = cropperRef.getCoordinates();
      if (coords) {
        setAspect(coords.width / coords.height);
      }
    } else {
      setAspect(undefined);
    }
  };

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
    setIsDirty(true);
  };
  const handleOutputWidthChange = (val) => {
    setManualOutputWidth(val);
    const num = parseInt(val);
    if (!isNaN(num)) {
      setOutputWidth(num);
      setIsDirty(true);
    }
  };
  const handleOutputWidthBlur = () => {
    setManualOutputWidth('');
  };

  // Visual Dims
  const isSideways = cropData.rotate % 180 !== 0;

  // Base visual dims from crop
  const rawW = isSideways ? cropData.height : cropData.width;
  const rawH = isSideways ? cropData.width : cropData.height;

  // Natural dims
  const natW = isSideways ? cropData.imageHeight : cropData.imageWidth;
  const natH = isSideways ? cropData.imageWidth : cropData.imageHeight;

  // Smart Clamp: If zooming out (raw > nat), show natural dim
  // (implying we scale down to fit original canvas), UNLESS manual output width overrides.
  // Actually manual output overrides all.
  // Here we just decide what "currentPixelWidth" means for stats.
  // If user sees 2000px but export will be 1000px, show 1000px?
  // Yes, consistent with "intact dimension".

  let visualW = rawW;
  let visualH = rawH;

  if (natW > 0 && rawW > natW) {
    visualW = natW;
    // Recalculate H based on aspect of selection?
    // Or just clamp both? Usually clamp width implies scaling factor.
    // Scaling factor = natW / rawW.
    // visualH = rawH * (natW / rawW).
    visualH = Math.round(rawH * (natW / rawW));
  }

  return {
    onCropperInit: setCropperRef,
    onCropperChange, // Passed to Preview
    isProcessing,
    isDirty,
    saved,

    // Stats
    currentPixelWidth: visualW,
    currentPixelHeight: visualH,
    logicalW: visualW,
    logicalH: visualH,
    rotation: cropData.rotate,

    // Controls
    // UI expects 'null' for freeform to match constant value
    aspect: aspect === undefined ? null : aspect,
    flip, // We might need to sync this from onChange too if we want UI button to highlight
    outputWidth,

    manualW,
    manualH,
    manualOutputWidth,

    // Handlers
    handleRotate,
    handleRotateDelta,
    handleRotateEnd,
    handleFlip,
    handleResetDraft,
    handleAspectClick,
    handleLockToggle,
    handleSelectionDimChange,
    handleDimBlur,
    handleResizeToggle,
    handleOutputWidthChange,
    handleOutputWidthBlur,
    handleSave,

    navigateNext,
    navigatePrev,

    // Key for hard reset
    cropperKey,

    // Stubs
    onImageLoad: () => {},
    visualUrl: null,
  };
};;;;
