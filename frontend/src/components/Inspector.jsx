import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, convertToPixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, RotateCw, FlipHorizontal, FlipVertical, 
  RotateCcw, Trash2, Maximize, Square, 
  RectangleVertical, Smartphone, RectangleHorizontal,
  Save, Check, Loader2, ChevronLeft, ChevronRight,
  MousePointer2, Layers, ArrowLeftCircle, ArrowRightCircle,
  Zap, RefreshCcw
} from 'lucide-react';
import './Inspector.css';

const ASPECT_PRESETS = [
  { label: 'Freeform', value: null, icon: MousePointer2 },
  { label: 'Square', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

const MAX_PREVIEW_DIM = 2000;
const MIN_CROP_SIZE = 20; // pixels

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
  onApplyTo
}) => {
  const [crop, setCrop] = useState();
  const [aspect, setAspect] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const [visualUrl, setVisualUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  
  const imgRef = useRef(null);
  const lastId = useRef(null);

  const getFullSizeCrop = useCallback((w, h) => {
    return {
      unit: '%',
      x: 0,
      y: 0,
      width: 100,
      height: 100
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
        finalCrop = convertToPixelCrop(finalCrop, imgRef.current.width, imgRef.current.height);
    }

    if (!finalCrop) return;

    const scaleX = (rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth) / imgRef.current.width;
    const scaleY = (rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight) / imgRef.current.height;

    const scaledCrop = {
      left: Math.round(finalCrop.x * scaleX),
      top: Math.round(finalCrop.y * scaleY),
      width: Math.round(finalCrop.width * scaleX),
      height: Math.round(finalCrop.height * scaleY),
    };

    onCropChange(image.id, {
      coordinates: scaledCrop,
      aspect,
      transforms: { rotate: rotation, flip }
    });
    setIsDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [crop, image, aspect, rotation, flip, isDirty, onCropChange, saved, getFullSizeCrop]);

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
      if (e.key === 'ArrowRight') navigateNext();
      if (e.key === 'ArrowLeft') navigatePrev();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
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
      setIsProcessing(true);
      const blob = await generateVisualSource(image.objectUrl, rotation, flip);
      if (!active) return;
      
      newUrl = URL.createObjectURL(blob);
      setVisualUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return newUrl;
      });
      setIsProcessing(false);
    };

    update();
    return () => {
      active = false;
    };
  }, [image.id, rotation, flip]);

  // Handle image selection change
  useEffect(() => {
    if (lastId.current !== image.id) {
       if (cropState) {
        setRotation(cropState.transforms?.rotate || 0);
        setFlip(cropState.transforms?.flip || { horizontal: false, vertical: false });
        setAspect(cropState.aspect || null);
        
        // Wait for image to load to set pixel-based crop
        setCrop(undefined); 
      } else {
        setCrop(undefined);
        setRotation(0);
        setFlip({ horizontal: false, vertical: false });
        setAspect(null);
      }
      setIsDirty(false);
      setSaved(false);
      lastId.current = image.id;
    }
  }, [image.id, cropState]);

  const onImageLoad = (e) => {
    imgRef.current = e.currentTarget;
    const { width, height } = e.currentTarget;

    if (cropState?.coordinates) {
      const scaleX = width / (rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth);
      const scaleY = height / (rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight);
      
      setCrop({
        unit: 'px',
        x: cropState.coordinates.left * scaleX,
        y: cropState.coordinates.top * scaleY,
        width: cropState.coordinates.width * scaleX,
        height: cropState.coordinates.height * scaleY,
      });
    } else if (aspect) {
      const newCrop = centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
        width,
        height
      );
      setCrop(newCrop);
    } else {
        setCrop(getFullSizeCrop(width, height));
    }
  };

  const handleCropChange = (c) => {
    // Enforce min size
    if (c.width < MIN_CROP_SIZE || c.height < MIN_CROP_SIZE) {
        if (c.unit === 'px') return; // Don't update if too small
    }
    setCrop(c);
    setIsDirty(true);
    setSaved(false);
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
        height
      );
      setCrop(newCrop);
    }
  };

  const handleCustomDimChange = (dim, value) => {
    if (!imgRef.current) return;
    const val = parseInt(value) || 0;
    const { width, height } = imgRef.current;
    
    const scaleX = width / (rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth);
    const scaleY = height / (rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight);

    setCrop(prev => {
        const next = { ...prev, unit: 'px' };
        if (dim === 'w') next.width = val * scaleX;
        if (dim === 'h') next.height = val * scaleY;
        
        // Ensure it doesn't exceed image bounds
        if (next.x + next.width > width) next.x = Math.max(0, width - next.width);
        if (next.y + next.height > height) next.y = Math.max(0, height - next.height);
        
        return next;
    });
    setIsDirty(true);
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setCrop(undefined); 
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

  const currentPixelWidth = imgRef.current && crop ? Math.round(convertToPixelCrop(crop, imgRef.current.width, imgRef.current.height).width * ((rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth) / imgRef.current.width)) : 0;
  const currentPixelHeight = imgRef.current && crop ? Math.round(convertToPixelCrop(crop, imgRef.current.width, imgRef.current.height).height * ((rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight) / imgRef.current.height)) : 0;

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
            <button className="btn-icon" onClick={navigatePrev} disabled={!hasPrev}>
                <ChevronLeft size={18} />
            </button>
            <button className="btn-icon" onClick={navigateNext} disabled={!hasNext}>
                <ChevronRight size={18} />
            </button>
          </div>
          <div className="toolbar-divider" />
          <button
            className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleSave}
            disabled={(!isDirty && !saved) || isProcessing}
          >
            {saved ? <Check size={14} /> : isProcessing ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
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
              <ReactCrop
                crop={crop}
                onChange={handleCropChange}
                onComplete={handleCropChange}
                aspect={aspect}
                className="custom-cropper"
                minWidth={MIN_CROP_SIZE}
                minHeight={MIN_CROP_SIZE}
              >
                <img
                  src={visualUrl || image.objectUrl}
                  onLoad={onImageLoad}
                  alt="editing"
                  style={{
                    opacity: isProcessing ? 0.3 : 1,
                    transition: 'opacity 0.2s',
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '65vh',
                    objectFit: 'contain',
                  }}
                />
              </ReactCrop>
            )}
          </div>

          <div className="inspector-stats">
            <div className="stat-pill">
                <Maximize size={10} />
                <span>{rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth} × {rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight}</span>
            </div>
            <div className="stat-pill active">
                <Layers size={10} />
                <span>Crop: {currentPixelWidth} × {currentPixelHeight}</span>
            </div>
          </div>
        </div>

        <div className="inspector-controls">
          <section className="control-section">
            <div className="section-header">
                <h3 className="section-label">Aspect Ratio</h3>
                <div className="custom-dims">
                    <input 
                        type="number" 
                        value={currentPixelWidth} 
                        onChange={(e) => handleCustomDimChange('w', e.target.value)}
                        placeholder="W"
                    />
                    <span>×</span>
                    <input 
                        type="number" 
                        value={currentPixelHeight} 
                        onChange={(e) => handleCustomDimChange('h', e.target.value)}
                        placeholder="H"
                    />
                </div>
            </div>
            <div className="aspect-grid">
              {ASPECT_PRESETS.map(({ label, value, icon: Icon }) => (
                <button
                  key={label}
                  className={`aspect-option ${aspect === value ? 'active' : ''}`}
                  onClick={() => handleAspectChange(value)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="control-section">
            <h3 className="section-label">Transform</h3>
            <div className="icon-action-row">
              <button className="btn-icon-box" title="Rotate 90°" onClick={handleRotate}>
                <RotateCw size={18} />
              </button>
              <button className={`btn-icon-box ${flip.horizontal ? 'active' : ''}`} title="Flip Horizontal" onClick={() => handleFlip(true)}>
                <FlipHorizontal size={18} />
              </button>
              <button className={`btn-icon-box ${flip.vertical ? 'active' : ''}`} title="Flip Vertical" onClick={() => handleFlip(false)}>
                <FlipVertical size={18} />
              </button>
              <button className="btn-icon-box" title="Reset Transforms" onClick={() => {
                  setRotation(0);
                  setFlip({ horizontal: false, vertical: false });
                  setIsDirty(true);
              }}>
                <RefreshCcw size={18} />
              </button>
            </div>
          </section>

          <section className="control-section">
            <h3 className="section-label">Bulk Apply Current Settings</h3>
            <div className="apply-grid">
                <button className="btn btn-secondary btn-sm" onClick={() => { if (isDirty) handleSave(); onApplyTo('prev'); }}>
                    <ArrowLeftCircle size={14} />
                    <span>Previous</span>
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { if (isDirty) handleSave(); onApplyTo('rest'); }}>
                    <span>Rest</span>
                    <ArrowRightCircle size={14} />
                </button>
                <button className="btn btn-primary btn-sm btn-glow" onClick={() => { if (isDirty) handleSave(); onApplyTo('all'); }}>
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
