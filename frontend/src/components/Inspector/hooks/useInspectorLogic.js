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

  // Sync Helper: Propagate current state to the store immediately
  const syncToStore = useCallback(
    (overrideAspect) => {
      if (!cropperRef) return;
      const coords = cropperRef.getCoordinates();
      const state = cropperRef.getState();
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

      onCropChange(image.id, {
        coordinates: {
          left: Math.round(coords.left),
          top: Math.round(coords.top),
          width: Math.round(coords.width),
          height: Math.round(coords.height),
        },
        aspect: currentAspect,
        transforms: {
          rotate: rotate,
          flip: currentFlip,
        },
        outputWidth: autoOutputWidth,
        imageWidth: Math.round(state?.imageSize?.width || 0),
        imageHeight: Math.round(state?.imageSize?.height || 0),
      });
    },
    [cropperRef, image.id, onCropChange, aspect, outputWidth],
  );

  // Callback whenever cropper changes (move, zoom, rotate)
  const onCropperChange = useCallback(
    (cropper) => {
      if (!cropper) return;
      const coords = cropper.getCoordinates();

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

        // Trigger immediate sync to store for "Live Crop Preview"
        syncToStore();
      }
    },
    [syncToStore],
  );

  // Initial Sync & Persistence on Change
  const lastId = useRef(null);

  // We use a ref to track the CURRENT sync function because we need to call it in cleanup
  // but we don't want the cleanup to re-run constantly if syncToStore changes identity (it shouldn't much, but still).
  const syncRef = useRef(syncToStore);
  useEffect(() => {
    syncRef.current = syncToStore;
  }, [syncToStore]);

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
    if (lastId.current !== image.id) {
      // Prepare new state...
      if (cropState) {
        const { rotate, flip: flipState } = cropState.transforms || {};
        setAspect(cropState.aspect || undefined);
        if (flipState) setFlip(flipState);
        else setFlip({ horizontal: false, vertical: false });

        if (cropState.outputWidth) setOutputWidth(cropState.outputWidth);
        else setOutputWidth(null);

        if (cropperRef) {
          cropperRef.reset();
          if (rotate) cropperRef.rotateImage(rotate);
          if (flipState) {
            if (flipState.horizontal) cropperRef.flipImage(true, false);
            if (flipState.vertical) cropperRef.flipImage(false, true);
          }
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
        if (cropperRef) {
          cropperRef.reset();
        }
      }

      lastId.current = image.id;
      setManualW('');
      setManualH('');
      setManualOutputWidth('');
    }
  }, [image.id, cropState, cropperRef]);

  const navigateNext = useCallback(() => {
    if (hasNext) {
      syncToStore();
      onNext();
    }
  }, [hasNext, syncToStore, onNext]);

  const navigatePrev = useCallback(() => {
    if (hasPrev) {
      syncToStore();
      onPrev();
    }
  }, [hasPrev, syncToStore, onPrev]);

  const handleClose = useCallback(() => {
    syncToStore();
    onClose();
  }, [syncToStore, onClose]);

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

  // Sync when aspect, flip, outputWidth, or cropper instance resets
  useEffect(() => {
    if (cropperRef) {
      syncToStore();
    }
  }, [aspect, flip, outputWidth, cropperKey, syncToStore]);

  // Actions
  const handleRotate = () => {
    if (cropperRef) {
      cropperRef.rotateImage(90);
      // Removed manual syncToStore, the effect above or onCropperChange will handle it
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

  const handleResetDraft = () => {
    setCropperKey((prev) => prev + 1);
    setAspect(undefined);
    setFlip({ horizontal: false, vertical: false });
    setOutputWidth(null);
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
    onCropperInit: setCropperRef,
    onCropperChange,
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

    handleClose,
    navigateNext,
    navigatePrev,

    // Key for hard reset
    cropperKey,

    // Stubs
    onImageLoad: () => {},
    visualUrl: null,
  };
};;;;;
