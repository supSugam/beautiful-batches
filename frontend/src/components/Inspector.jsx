import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  convertToPixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  Trash2,
  Maximize,
  Square,
  RectangleVertical,
  Smartphone,
  RectangleHorizontal,
  Save,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Layers,
  ArrowLeftCircle,
  ArrowRightCircle,
  Zap,
  RefreshCcw,
  Lock,
  Unlock,
  Link,
} from 'lucide-react';
import './Inspector.css';
import { RotationSlider } from './RotationSlider';

const ASPECT_PRESETS = [
  { label: 'Freeform', value: null, icon: MousePointer2 },
  { label: 'Square', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

const MAX_PREVIEW_DIM = 2000;
const MIN_CROP_PERCENT = 0.05; // 5% of image size

/**
 * Generates a rotated and flipped version of the image source
 * Optimized with scaling for faster performance
 */
async function generateVisualSource(imageUrl, rotation, flip) {
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve) => (img.onload = resolve));

  const isRotated90 = rotation % 180 === 90;

  // Calculate scaled dimensions for preview
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  let targetW = isRotated90 ? origH : origW;
  let targetH = isRotated90 ? origW : origH;

  let scale = 1;
  if (targetW > MAX_PREVIEW_DIM || targetH > MAX_PREVIEW_DIM) {
    scale = Math.min(MAX_PREVIEW_DIM / targetW, MAX_PREVIEW_DIM / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = targetW;
  canvas.height = targetH;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);

  const drawW = origW * scale;
  const drawH = origH * scale;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Use slightly lower quality for faster encoding
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
}

export const Inspector = ({
  image,
  cropState,
  onCropChange,
  onClose,
  onDelete,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onApplyTo,
}) => {
  const [crop, setCrop] = useState();
  const [aspect, setAspect] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const [visualUrl, setVisualUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [debouncedRotation, setDebouncedRotation] = useState(0);
  const [lastBakedRotation, setLastBakedRotation] = useState(0);

  // Output Resize State
  const [outputWidth, setOutputWidth] = useState(null);

  // LOGICAL DIMENSIONS (Natural Pixels)
  // We keep the calculated natural dimensions here to avoid jitter from display-scale rounding
  const [logicalW, setLogicalW] = useState(0);
  const [logicalH, setLogicalH] = useState(0);
  // Manual input strings to allow typing freely (e.g. "1" then "10" then "102")
  const [manualW, setManualW] = useState('');
  const [manualH, setManualH] = useState('');
  const [manualOutputWidth, setManualOutputWidth] = useState('');

  const imgRef = useRef(null);
  const lastId = useRef(null);

  const getFullSizeCrop = useCallback((w, h) => {
    return {
      unit: '%',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
  }, []);

  // Handle saving logic
  const handleSave = useCallback(() => {
    if (!isDirty && !saved) return;

    let finalCrop = crop;
    if (!finalCrop && imgRef.current) {
      finalCrop = getFullSizeCrop(imgRef.current.width, imgRef.current.height);
    }

    if (finalCrop && finalCrop.unit === '%' && imgRef.current) {
      finalCrop = convertToPixelCrop(
        finalCrop,
        imgRef.current.width,
        imgRef.current.height,
      );
    }

    if (!finalCrop) return;

    const scaleX =
      (rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth) /
      imgRef.current.width;
    const scaleY =
      (rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight) /
      imgRef.current.height;

    const scaledCrop = {
      left: Math.round(finalCrop.x * scaleX),
      top: Math.round(finalCrop.y * scaleY),
      width: Math.round(finalCrop.width * scaleX),
      height: Math.round(finalCrop.height * scaleY),
    };

    onCropChange(image.id, {
      coordinates: scaledCrop,
      aspect,
      transforms: { rotate: rotation, flip },
      outputWidth: outputWidth,
    });
    setIsDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [
    crop,
    image,
    aspect,
    rotation,
    flip,
    isDirty,
    onCropChange,
    saved,
    getFullSizeCrop,
    outputWidth,
  ]);

  // Navigation with auto-save
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input
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

  // Update visual source whenever orientation changes
  useEffect(() => {
    let active = true;
    let newUrl = null;

    const update = async () => {
      // Don't process if it's identical to what we already have
      if (debouncedRotation === lastBakedRotation && visualUrl) return;

      setIsProcessing(true);
      const blob = await generateVisualSource(
        image.objectUrl,
        debouncedRotation,
        flip,
      );
      if (!active) return;

      newUrl = URL.createObjectURL(blob);
      setVisualUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return newUrl;
      });
      setLastBakedRotation(debouncedRotation);
      setIsProcessing(false);
    };

    update();
    return () => {
      active = false;
    };
  }, [
    image.id,
    debouncedRotation,
    flip,
    visualUrl,
    lastBakedRotation,
    image.objectUrl,
  ]);

  // Sync debounced rotation
  useEffect(() => {
    if (isSliderDragging) return;
    const timer = setTimeout(() => {
      setDebouncedRotation(rotation);
    }, 150); // Small delay to avoid flickering
    return () => clearTimeout(timer);
  }, [rotation, isSliderDragging]);

  // Handle image selection change
  useEffect(() => {
    if (lastId.current !== image.id) {
      if (cropState) {
        setRotation(cropState.transforms?.rotate || 0);
        setFlip(
          cropState.transforms?.flip || { horizontal: false, vertical: false },
        );
        setAspect(cropState.aspect || null);
        setOutputWidth(cropState.outputWidth || null);

        // Wait for image to load to set pixel-based crop
        setCrop(undefined);
      } else {
        setCrop(undefined);
        setRotation(0);
        setFlip({ horizontal: false, vertical: false });
        setAspect(null);
        setOutputWidth(null);
      }
      setIsDirty(false);
      setSaved(false);
      setVisualUrl(null); // Clear old visual URL immediately
      setLastBakedRotation(0); // Reset sync state
      setDebouncedRotation(0);
      lastId.current = image.id;

      // Clear manual overrides on ID switch
      setManualW('');
      setManualH('');
    }
  }, [image.id, cropState]);

  const onImageLoad = (e) => {
    imgRef.current = e.currentTarget;
    const { width, height } = e.currentTarget;
    const naturalW =
      rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
    const naturalH =
      rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;

    let finalCrop;
    if (cropState?.coordinates) {
      const scaleX = width / naturalW;
      const scaleY = height / naturalH;

      finalCrop = {
        unit: 'px',
        x: cropState.coordinates.left * scaleX,
        y: cropState.coordinates.top * scaleY,
        width: cropState.coordinates.width * scaleX,
        height: cropState.coordinates.height * scaleY,
      };
    } else if (aspect) {
      finalCrop = centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
        width,
        height,
      );
    } else {
      finalCrop = getFullSizeCrop(width, height);
    }

    setCrop(finalCrop);

    // Initialize Logical Dimensions (Natural Pixels)
    const pxCrop =
      finalCrop.unit === '%'
        ? {
            width: (finalCrop.width * width) / 100,
            height: (finalCrop.height * height) / 100,
          }
        : finalCrop;

    setLogicalW(Math.round(pxCrop.width * (naturalW / width)));
    setLogicalH(Math.round(pxCrop.height * (naturalH / height)));
  };

  const handleCropChange = (c) => {
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      const snapThreshold = 4; // Display pixels

      if (c.unit === 'px') {
        // Snap to absolute edges if within threshold
        if (c.x < snapThreshold) {
          c.width += c.x;
          c.x = 0;
        }
        if (c.y < snapThreshold) {
          c.height += c.y;
          c.y = 0;
        }
        if (width - (c.x + c.width) < snapThreshold) {
          c.width = width - c.x;
        }
        if (height - (c.y + c.height) < snapThreshold) {
          c.height = height - c.y;
        }

        // Final sanity clamping to container
        c.x = Math.max(0, c.x);
        c.y = Math.max(0, c.y);
        c.width = Math.min(c.width, width - c.x);
        c.height = Math.min(c.height, height - c.y);

        if (aspect) {
          // Re-balance to keep aspect ratio while respecting the "fixed" edge if possible
          if (Math.abs(c.width / c.height - aspect) > 0.001) {
            // For simplicity, adjust height to match width
            c.height = c.width / aspect;
            if (c.y + c.height > height) {
              c.height = height - c.y;
              c.width = c.height * aspect;
            }
          }
        }
      }
    }

    setCrop(c);
    setIsDirty(true);
    setSaved(false);

    // Clear manual overrides when dragging to re-sync from logical dims
    setManualW('');
    setManualH('');

    // Update logical dims based on NEW crop
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      const naturalW =
        rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
      const naturalH =
        rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;

      const pxCrop =
        c.unit === '%'
          ? {
              width: (c.width * width) / 100,
              height: (c.height * height) / 100,
            }
          : c;

      setLogicalW(Math.round(pxCrop.width * (naturalW / width)));
      setLogicalH(Math.round(pxCrop.height * (naturalH / height)));
    }
  };

  const handleAspectChange = (value) => {
    if (value === null && aspect === null) {
      // Reset to full image if clicking freeform while already in freeform
      if (imgRef.current) {
        setCrop(getFullSizeCrop(imgRef.current.width, imgRef.current.height));
        setIsDirty(true);
      }
      return;
    }

    setAspect(value);
    setIsDirty(true);
    if (imgRef.current && value) {
      const { width, height } = imgRef.current;
      const newCrop = centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, value, width, height),
        width,
        height,
      );
      setCrop(newCrop);
    }
  };

  // --- Dimensions & Ratio Logic ---

  const handleLockToggle = () => {
    if (aspect) {
      // Unlock Ratio
      setAspect(null);
    } else {
      // Lock Ratio to current state
      const width = currentPixelWidth || image.naturalWidth;
      const height = currentPixelHeight || image.naturalHeight;
      setAspect(width / height);
    }
    setIsDirty(true);
  };

  const handleSelectionDimChange = (dim, value) => {
    // Always update manual state immediately to allow free typing/erasure
    if (dim === 'w') setManualW(value);
    else setManualH(value);

    if (value === '') return;

    let val = parseInt(value);
    if (isNaN(val)) return;

    if (imgRef.current) {
      const { width, height } = imgRef.current;
      const naturalWidth =
        rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
      const naturalHeight =
        rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;
      const scaleX = width / naturalWidth;
      const scaleY = height / naturalHeight;

      // Soft Min Clamp (Percentage of total)
      const minW = Math.max(10, Math.round(naturalWidth * MIN_CROP_PERCENT));
      const minH = Math.max(10, Math.round(naturalHeight * MIN_CROP_PERCENT));

      const limit = dim === 'w' ? naturalWidth : naturalHeight;
      const softMin = dim === 'w' ? minW : minH;

      // LIVE CLAMP (Soft): Stay within image bounds for the crop,
      // but don't force-set the input value yet.
      const clampedVal = Math.max(softMin, Math.min(val, limit));

      let newNaturalW = dim === 'w' ? clampedVal : logicalW || naturalWidth;
      let newNaturalH = dim === 'h' ? clampedVal : logicalH || naturalHeight;

      if (aspect) {
        if (dim === 'w') {
          newNaturalH = Math.round(newNaturalW / aspect);
          // Clamp to max
          if (newNaturalH > naturalHeight) {
            newNaturalH = naturalHeight;
            newNaturalW = Math.round(newNaturalH * aspect);
          }
          // Clamp to min
          if (newNaturalH < minH) {
            newNaturalH = minH;
            newNaturalW = Math.round(newNaturalH * aspect);
          }
        } else {
          newNaturalW = Math.round(newNaturalH * aspect);
          // Clamp to max
          if (newNaturalW > naturalWidth) {
            newNaturalW = naturalWidth;
            newNaturalH = Math.round(newNaturalW / aspect);
          }
          // Clamp to min
          if (newNaturalW < minW) {
            newNaturalW = minW;
            newNaturalH = Math.round(newNaturalW / aspect);
          }
        }
      }

      // Sync logical state only (don't overwrite manual state while typing)
      setLogicalW(newNaturalW);
      setLogicalH(newNaturalH);

      // Apply to crop
      setCrop(() => {
        const displayW = newNaturalW * scaleX;
        const displayH = newNaturalH * scaleY;
        const cropAspect = aspect || newNaturalW / newNaturalH;

        return centerCrop(
          makeAspectCrop(
            { unit: 'px', width: displayW, height: displayH },
            cropAspect,
            width,
            height,
          ),
          width,
          height,
        );
      });
      setIsDirty(true);
    }
  };

  const handleDimBlur = (dim) => {
    const rawValue = dim === 'w' ? manualW : manualH;
    if (rawValue === '') {
      setManualW('');
      setManualH('');
      return;
    }

    let val = parseInt(rawValue);
    const naturalWidth =
      rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
    const naturalHeight =
      rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;
    const limit = dim === 'w' ? naturalWidth : naturalHeight;

    // HARD CLAMP: Enforce min (percentage of total) and max
    const minW = Math.max(10, Math.round(naturalWidth * MIN_CROP_PERCENT));
    const minH = Math.max(10, Math.round(naturalHeight * MIN_CROP_PERCENT));
    const minSize = dim === 'w' ? minW : minH;

    const finalVal = Math.max(
      minSize,
      Math.min(isNaN(val) ? limit : val, limit),
    );

    // Update logical and CLEAR manual to revert to formatted value
    if (dim === 'w') {
      if (aspect) {
        let finalH = Math.round(finalVal / aspect);
        // Clamp H
        finalH = Math.max(minH, Math.min(finalH, naturalHeight));
        // Sync W
        const syncedW = Math.round(finalH * aspect);
        setLogicalW(syncedW);
        setLogicalH(finalH);
      } else {
        setLogicalW(finalVal);
      }
    } else {
      if (aspect) {
        let finalW = Math.round(finalVal * aspect);
        // Clamp W
        finalW = Math.max(minW, Math.min(finalW, naturalWidth));
        // Sync H
        const syncedH = Math.round(finalW / aspect);
        setLogicalW(finalW);
        setLogicalH(syncedH);
      } else {
        setLogicalH(finalVal);
      }
    }

    setManualW('');
    setManualH('');
  };

  const handleAspectClick = (presetValue) => {
    if (presetValue === null) {
      setAspect(null);
    } else {
      setAspect(presetValue);
      // Always update the crop rect to reflect the new aspect ratio immediately
      if (imgRef.current) {
        const { width, height } = imgRef.current;
        const newCrop = centerCrop(
          makeAspectCrop({ unit: '%', width: 90 }, presetValue, width, height),
          width,
          height,
        );
        setCrop(newCrop);

        // Update Logical Dimensions
        const naturalW =
          rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
        const naturalH =
          rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;
        setLogicalW(Math.round(((90 * width) / 100) * (naturalW / width))); // 90 because we use width: 90 in makeAspectCrop
        if (presetValue) {
          setLogicalH(
            Math.round(
              ((90 * width) / 100 / presetValue) * (naturalH / height),
            ),
          );
        } else {
          setLogicalH(Math.round(height * (naturalH / height)));
        }
      }
    }
    setIsDirty(true);
  };

  const handleResizeToggle = () => {
    if (outputWidth) {
      setOutputWidth(null);
      setManualOutputWidth('');
    } else {
      // Default to current selection width
      setOutputWidth(currentPixelWidth || 1024);
      setManualOutputWidth('');
    }
    setIsDirty(true);
  };

  const handleOutputWidthChange = (val) => {
    setManualOutputWidth(val);
    if (val === '') return;
    const num = parseInt(val);
    if (!isNaN(num) && num > 0) {
      // Soft update while typing (can exceed bounds, but must be > 0)
      setOutputWidth(num);
      setIsDirty(true);
    }
  };

  const handleOutputWidthBlur = () => {
    if (manualOutputWidth === '') {
      setManualOutputWidth('');
      return;
    }
    let val = parseInt(manualOutputWidth);
    const baseW = currentPixelWidth || 1024;
    if (isNaN(val) || val < 1) val = baseW;

    // Relative Limits: 0.1x to 5.0x
    const minW = Math.max(1, Math.round(baseW * 0.1));
    const maxW = Math.round(baseW * 5.0);

    val = Math.max(minW, Math.min(val, maxW));

    setOutputWidth(val);
    setManualOutputWidth('');
  };

  const handleRotate = (newRotation) => {
    // Only reset crop if it's a major rotation change (threshold of 45 deg)
    // For small adjustments, we keep the crop to avoid the "jumping" feel.
    if (Math.abs(newRotation - rotation) > 45) {
      setCrop(undefined);
    }

    setRotation(newRotation);
    setIsDirty(true);
    setSaved(false);
  };

  const handleFlip = (horizontal) => {
    setFlip((prev) => ({
      ...prev,
      [horizontal ? 'horizontal' : 'vertical']:
        !prev[horizontal ? 'horizontal' : 'vertical'],
    }));
    setIsDirty(true);
    setSaved(false);
  };

  // Precise Natural Pixel Calculations
  const currentPixelWidth = useMemo(() => {
    if (manualW !== '') {
      const val = parseInt(manualW);
      if (!isNaN(val)) return val;
    }
    return logicalW;
  }, [logicalW, manualW]);

  const currentPixelHeight = useMemo(() => {
    if (manualH !== '') {
      const val = parseInt(manualH);
      if (!isNaN(val)) return val;
    }
    return logicalH;
  }, [logicalH, manualH]);

  const { minDisplayW, minDisplayH } = useMemo(() => {
    if (!imgRef.current) return { minDisplayW: 10, minDisplayH: 10 };
    const { width, height } = imgRef.current;

    // Natural dimensions
    const naturalW =
      rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth;
    const naturalH =
      rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight;

    // Dynamic minimums in display pixels
    return {
      minDisplayW: Math.max(
        10,
        naturalW * MIN_CROP_PERCENT * (width / naturalW),
      ),
      minDisplayH: Math.max(
        10,
        naturalH * MIN_CROP_PERCENT * (height / naturalH),
      ),
    };
  }, [imgRef.current?.width, imgRef.current?.height, image, rotation]);

  if (!image) return null;

  return (
    <motion.div
      initial={{ x: 500, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 500, opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200 }}
      className="inspector"
    >
      <div className="inspector-header">
        <div className="inspector-title">
          <span>Editing Selection</span>
          <strong>{image.name}</strong>
        </div>
        <div className="header-actions">
          <div className="nav-arrows">
            <button
              className="btn-icon"
              onClick={navigatePrev}
              disabled={!hasPrev}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="btn-icon"
              onClick={navigateNext}
              disabled={!hasNext}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="toolbar-divider" />
          <button
            className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleSave}
            disabled={(!isDirty && !saved) || isProcessing}
          >
            {saved ? (
              <Check size={14} />
            ) : isProcessing ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Save size={14} />
            )}
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="inspector-scroll">
        <div className="inspector-preview-section">
          <div className="inspector-crop-container">
            {isProcessing && !visualUrl ? (
              <Loader2 className="spin text-muted" size={32} />
            ) : (
              (() => {
                const isOutOfSync =
                  rotation !== lastBakedRotation || isSliderDragging;
                return (
                  <ReactCrop
                    crop={crop}
                    onChange={handleCropChange}
                    onComplete={handleCropChange}
                    aspect={aspect}
                    className={`custom-cropper ${isOutOfSync ? 'dragging-rotation' : ''}`}
                    minWidth={minDisplayW}
                    minHeight={minDisplayH}
                  >
                    <img
                      src={
                        isOutOfSync
                          ? image.objectUrl
                          : visualUrl || image.objectUrl
                      }
                      onLoad={onImageLoad}
                      alt="editing"
                      style={{
                        opacity: isProcessing && !isOutOfSync ? 0.3 : 1,
                        transition: 'opacity 0.2s, transform 0.1s ease-out',
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: '65vh',
                        objectFit: 'contain',
                        transform: isOutOfSync
                          ? `rotate(${rotation}deg)`
                          : 'none',
                      }}
                    />
                  </ReactCrop>
                );
              })()
            )}
          </div>

          <div className="inspector-stats">
            <div className="stat-pill">
              <Maximize size={10} />
              <span>
                Original:{' '}
                {rotation % 180 === 90
                  ? image.naturalHeight
                  : image.naturalWidth}{' '}
                ×{' '}
                {rotation % 180 === 90
                  ? image.naturalWidth
                  : image.naturalHeight}
              </span>
            </div>
            <div className={`stat-pill ${outputWidth ? 'active' : ''}`}>
              <Layers size={10} />
              <span>
                {outputWidth
                  ? (() => {
                      const ratio =
                        aspect || currentPixelWidth / currentPixelHeight;
                      const h = Math.round(outputWidth / ratio) || 0;
                      const scale = (
                        outputWidth / (currentPixelWidth || 1)
                      ).toFixed(2);
                      return `Output: ${outputWidth} × ${h} (${scale}x)`;
                    })()
                  : `Selection: ${currentPixelWidth} × ${currentPixelHeight}`}
              </span>
            </div>
          </div>
        </div>

        <div className="inspector-controls">
          {/* 1. SELECTION DIMENSIONS (Strictly Crop) */}
          <section className="control-section">
            <div className="section-header">
              <h3 className="section-label">Selection (Crop)</h3>
              <button
                className={`btn-icon-subtle ${aspect ? 'active' : ''}`}
                onClick={handleLockToggle}
                title={aspect ? 'Unlock Ratio' : 'Lock Ratio'}
              >
                {aspect ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>

            <div className="dims-grid">
              <div className="dim-input-group">
                <label>W</label>
                <input
                  type="number"
                  value={manualW !== '' ? manualW : currentPixelWidth || ''}
                  onChange={(e) =>
                    handleSelectionDimChange('w', e.target.value)
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  onBlur={() => handleDimBlur('w')}
                />
              </div>
              <div className="dim-link-icon">
                <Link size={10} className={aspect ? 'active' : ''} />
              </div>
              <div className="dim-input-group">
                <label>H</label>
                <input
                  type="number"
                  value={manualH !== '' ? manualH : currentPixelHeight || ''}
                  onChange={(e) =>
                    handleSelectionDimChange('h', e.target.value)
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  onBlur={() => handleDimBlur('h')}
                />
              </div>
            </div>

            <div className="aspect-grid">
              {ASPECT_PRESETS.map(({ label, value, icon: Icon }) => {
                const isActive = aspect === value;
                return (
                  <button
                    key={label}
                    className={`aspect-option ${isActive ? 'active' : ''}`}
                    onClick={() => handleAspectClick(value)}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. EXPORT RESIZE (Target Output) */}
          <section className="control-section">
            <div className="section-header">
              <h3 className="section-label">Export Resize</h3>
              <button
                className={`btn-icon-subtle ${outputWidth ? 'active' : ''}`}
                onClick={handleResizeToggle}
                title="Enable/Disable Resize"
              >
                {outputWidth ? <Check size={12} /> : <Square size={12} />}
              </button>
            </div>

            {outputWidth !== null && (
              <div className="dims-grid">
                <div className="dim-input-group">
                  <label>W</label>
                  <input
                    type="number"
                    value={
                      manualOutputWidth !== ''
                        ? manualOutputWidth
                        : outputWidth || ''
                    }
                    onChange={(e) => handleOutputWidthChange(e.target.value)}
                    onBlur={handleOutputWidthBlur}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="dim-link-icon">
                  <span style={{ fontSize: 10, opacity: 0.5 }}>×</span>
                </div>
                <div className="dim-input-group disabled">
                  <label>H</label>
                  <input
                    type="number"
                    disabled
                    value={(() => {
                      const ratio =
                        aspect || currentPixelWidth / currentPixelHeight;
                      return Math.round(outputWidth / ratio) || 0;
                    })()}
                  />
                </div>
              </div>
            )}
          </section>

          <div className="inspector-divider" />

          {/* Rotation Slider */}

          <section className="control-section">
            <h3 className="section-label">Transform</h3>
            <div className="icon-action-row">
              <RotationSlider
                value={rotation}
                onChange={handleRotate}
                onDraggingChange={setIsSliderDragging}
              />
              <div className="icon-action-row-inner">
                <button
                  className={`btn-icon-box ${flip.horizontal ? 'active' : ''}`}
                  title="Flip Horizontal"
                  onClick={() => handleFlip(true)}
                >
                  <FlipHorizontal size={18} />
                </button>
                <button
                  className={`btn-icon-box ${flip.vertical ? 'active' : ''}`}
                  title="Flip Vertical"
                  onClick={() => handleFlip(false)}
                >
                  <FlipVertical size={18} />
                </button>
                <button
                  className="btn-icon-box"
                  title="Reset Transforms"
                  onClick={() => {
                    setRotation(0);
                    setFlip({ horizontal: false, vertical: false });
                    setIsDirty(true);
                  }}
                >
                  <RefreshCcw size={18} />
                </button>
              </div>
            </div>
          </section>

          <section className="control-section">
            <h3 className="section-label">Bulk Apply Current Settings</h3>
            <div className="apply-grid">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (isDirty) handleSave();
                  onApplyTo('prev');
                }}
              >
                <ArrowLeftCircle size={14} />
                <span>Previous</span>
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (isDirty) handleSave();
                  onApplyTo('rest');
                }}
              >
                <span>Rest</span>
                <ArrowRightCircle size={14} />
              </button>
              <button
                className="btn btn-primary btn-sm btn-glow"
                onClick={() => {
                  if (isDirty) handleSave();
                  onApplyTo('all');
                }}
              >
                <Zap size={14} />
                <span>All Images</span>
              </button>
            </div>
          </section>

          <div className="inspector-divider" />

          <section className="control-section danger-zone">
            <div className="action-row">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRotation(0);
                  setFlip({ horizontal: false, vertical: false });
                  setCrop(undefined);
                  setAspect(null);
                  setIsDirty(true);
                }}
              >
                <RotateCcw size={14} />
                <span>Reset Draft</span>
              </button>
              <button
                className="btn btn-ghost btn-danger-ghost btn-sm"
                onClick={() => {
                  onDelete(image.id);
                  onClose();
                }}
              >
                <Trash2 size={14} />
                <span>Delete File</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
};
