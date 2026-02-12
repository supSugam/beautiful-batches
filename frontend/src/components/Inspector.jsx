import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, convertToPixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, RotateCw, FlipHorizontal, FlipVertical, 
  RotateCcw, Trash2, Maximize, Square, 
  RectangleVertical, Smartphone, RectangleHorizontal,
  Save, Check, Loader2
} from 'lucide-react';
import './Inspector.css';

const ASPECT_PRESETS = [
  { label: 'Free', value: null, icon: Maximize },
  { label: '1:1', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

/**
 * Generates a rotated and flipped version of the image source
 */
async function generateVisualSource(imageUrl, rotation, flip) {
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve) => (img.onload = resolve));

  const isRotated90 = rotation % 180 === 90;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = isRotated90 ? img.height : img.width;
  canvas.height = isRotated90 ? img.width : img.height;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
}

export const Inspector = ({ 
  image, 
  cropState, 
  onCropChange, 
  onClose,
  onDelete 
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
      // Note: We don't revoke newUrl here because it might be the one we just set
    };
  }, [image.id, rotation, flip]);

  // Handle image selection change
  useEffect(() => {
    if (lastId.current !== image.id) {
       if (cropState) {
        setCrop(cropState.coordinates);
        setRotation(cropState.transforms?.rotate || 0);
        setFlip(cropState.transforms?.flip || { horizontal: false, vertical: false });
        setAspect(cropState.aspect || null);
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
    if (aspect && !crop) {
      const { width, height } = e.currentTarget;
      const newCrop = centerCrop(
        makeAspectCrop(
          { unit: '%', width: 90 },
          aspect,
          width,
          height
        ),
        width,
        height
      );
      setCrop(newCrop);
    }
  };

  const handleCropChange = (c) => {
    setCrop(c);
    setIsDirty(true);
    setSaved(false);
  };

  const handleAspectChange = (value) => {
    setAspect(value);
    setIsDirty(true);
    if (imgRef.current && value) {
      const { width, height } = imgRef.current;
      const newCrop = centerCrop(
        makeAspectCrop(
          { unit: '%', width: 90 },
          value,
          width,
          height
        ),
        width,
        height
      );
      setCrop(newCrop);
    }
  };

  const handleSave = () => {
    let finalCrop = crop;
    if (crop && crop.unit === '%' && imgRef.current) {
        finalCrop = convertToPixelCrop(crop, imgRef.current.width, imgRef.current.height);
    }

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
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setCrop(undefined); // Reset crop to trigger re-center on next load
    setIsDirty(true);
    setSaved(false);
  };

  const handleFlip = (horizontal) => {
    setFlip((prev) => ({
      ...prev,
      [horizontal ? 'horizontal' : 'vertical']:
        !prev[horizontal ? 'horizontal' : 'vertical'],
    }));
    // We don't necessarily need to reset crop for flips, but it keeps things consistent
    setIsDirty(true);
    setSaved(false);
  };

  const handleReset = () => {
    setCrop(undefined);
    setRotation(0);
    setFlip({ horizontal: false, vertical: false });
    setAspect(null);
    setIsDirty(true);
    setSaved(false);
  };

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
            <span>{saved ? 'Saved' : 'Save Changes'}</span>
          </button>
          <div className="toolbar-divider" />
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
                    maxHeight: '70vh',
                    objectFit: 'contain',
                  }}
                />
              </ReactCrop>
            )}
          </div>

          <div className="inspector-caption">
            {rotation % 180 === 90 ? image.naturalHeight : image.naturalWidth} ×{' '}
            {rotation % 180 === 90 ? image.naturalWidth : image.naturalHeight} •{' '}
            {image.file.type.split('/')[1].toUpperCase()}
          </div>
        </div>

        <div className="inspector-controls">
          <section className="control-section">
            <h3 className="section-label">Aspect Ratio</h3>
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
            <h3 className="section-label">Orientation & Transform</h3>
            <div className="action-row">
              <button className="btn btn-secondary" onClick={handleRotate}>
                <RotateCw size={14} />
                <span>Rotate 90°</span>
              </button>
              <button
                className={`btn ${flip.horizontal ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleFlip(true)}
              >
                <FlipHorizontal size={14} />
                <span>Mirror H</span>
              </button>
              <button
                className={`btn ${flip.vertical ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleFlip(false)}
              >
                <FlipVertical size={14} />
                <span>Mirror V</span>
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
