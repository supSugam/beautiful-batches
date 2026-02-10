import React, { useState, useRef, useCallback, memo } from 'react';
import { Cropper } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import {
  Settings, X, RotateCcw, Trash2,
  Lock, Unlock, Maximize, Square,
  RectangleVertical, Smartphone, RectangleHorizontal
} from 'lucide-react';
import './ImageCard.css';

const ASPECT_PRESETS = [
  { label: 'Free', value: null, icon: Maximize },
  { label: '1:1', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

export const ImageCard = memo(({ image, cropState, onCropChange, onDelete, globalAspect }) => {
  const [expanded, setExpanded] = useState(false);
  const [localAspect, setLocalAspect] = useState(undefined); // undefined = use global
  const cropperRef = useRef(null);

  const effectiveAspect = localAspect !== undefined ? localAspect : globalAspect;

  const handleCropEnd = useCallback(() => {
    if (!cropperRef.current) return;
    const coords = cropperRef.current.getCoordinates();
    if (coords) {
      onCropChange(image.id, coords);
    }
  }, [image.id, onCropChange]);

  const handleResetCrop = useCallback(() => {
    if (cropperRef.current) {
      cropperRef.current.reset();
      // After reset, get the new coordinates
      setTimeout(() => {
        const coords = cropperRef.current?.getCoordinates();
        if (coords) onCropChange(image.id, coords);
      }, 50);
    }
    setLocalAspect(undefined);
  }, [image.id, onCropChange]);

  const handleAspectChange = useCallback((value) => {
    setLocalAspect(value);
  }, []);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    onDelete(image.id);
  }, [image.id, onDelete]);

  return (
    <div className={`image-card ${expanded ? 'expanded' : ''}`}>
      {/* Cropper */}
      <div className="card-cropper">
        <Cropper
          ref={cropperRef}
          src={image.objectUrl}
          onChange={handleCropEnd}
          stencilProps={{
            aspectRatio: effectiveAspect || undefined,
            grid: true,
          }}
          className="cropper-instance"
        />

        {/* Toggle Button */}
        <button
          className={`card-toggle ${expanded ? 'active' : ''}`}
          onClick={handleToggle}
          title="Image options"
        >
          <Settings size={14} />
        </button>

        {/* Quick Delete */}
        <button
          className="card-delete"
          onClick={handleDelete}
          title="Remove image"
        >
          <X size={14} />
        </button>
      </div>

      {/* Filename */}
      <div className="card-filename" title={image.relativePath || image.name}>
        {image.name}
      </div>

      {/* Expandable Footer */}
      <div className={`card-footer ${expanded ? 'open' : ''}`}>
        <div className="footer-content">
          {/* Aspect Ratio Presets */}
          <div className="footer-section">
            <span className="footer-label">Aspect</span>
            <div className="aspect-pills">
              {ASPECT_PRESETS.map(({ label, value, icon: Icon }) => (
                <button
                  key={label}
                  className={`aspect-pill ${
                    (localAspect !== undefined ? localAspect : 'global') ===
                    (value !== null ? value : null)
                      ? localAspect !== undefined ? 'active' : ''
                      : ''
                  } ${localAspect === value ? 'active' : ''} ${
                    localAspect === undefined && globalAspect === value ? 'global-active' : ''
                  }`}
                  onClick={() => handleAspectChange(value)}
                  title={label}
                >
                  <Icon size={12} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="footer-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleResetCrop}>
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
            <button className="btn btn-danger-ghost btn-sm" onClick={handleDelete}>
              <Trash2 size={12} />
              <span>Remove</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ImageCard.displayName = 'ImageCard';
