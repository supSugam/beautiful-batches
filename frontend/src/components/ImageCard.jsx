import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Cropper } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import {
  Settings,
  X,
  RotateCcw,
  Trash2,
  Maximize,
  Square,
  RectangleVertical,
  Smartphone,
  RectangleHorizontal,
} from 'lucide-react';
import './ImageCard.css';

const ASPECT_PRESETS = [
  { label: 'Free', value: null, icon: Maximize },
  { label: '1:1', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

export const ImageCard = memo(
  ({ image, cropState, onCropChange, onDelete, rowHeight }) => {
    const [expanded, setExpanded] = useState(false);
    const [localAspect, setLocalAspect] = useState(undefined);
    const cropperRef = useRef(null);

    const effectiveAspect = localAspect !== undefined ? localAspect : undefined;

    const handleCropEnd = useCallback(() => {
      if (!cropperRef.current) return;
      const coords = cropperRef.current.getCoordinates();
      if (coords) {
        onCropChange(image.id, coords);
      }
    }, [image.id, onCropChange]);

    // Force refresh when row height changes
    useEffect(() => {
      if (cropperRef.current) {
        cropperRef.current.refresh();
      }
    }, [rowHeight]);

    // Robust fix: Stop wheel events from reaching the Cropper
    // This allows page scrolling and disables zoom even if the library ignores props
    const wrapperRef = useRef(null);
    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const handleWheel = (e) => {
        // Stop the event from reaching the Cropper (children)
        e.stopPropagation();
        // Do NOT preventDefault() - this allows the page to scroll
      };

      wrapper.addEventListener('wheel', handleWheel, {
        capture: true,
        passive: false,
      });
      return () => {
        wrapper.removeEventListener('wheel', handleWheel, { capture: true });
      };
    }, []);

    const handleResetCrop = useCallback(() => {
      if (cropperRef.current) {
        cropperRef.current.reset();
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
      setExpanded((prev) => !prev);
    }, []);

    const handleDelete = useCallback(
      (e) => {
        e.stopPropagation();
        onDelete(image.id);
      },
      [image.id, onDelete],
    );

    return (
      <div
        className={`image-card ${expanded ? 'expanded' : ''}`}
        style={{ width: '100%' }}
      >
        <div
          className="card-cropper"
          style={{ height: rowHeight }}
          ref={wrapperRef}
        >
          <Cropper
            ref={cropperRef}
            src={image.objectUrl}
            onChange={handleCropEnd}
            stencilProps={{
              aspectRatio: effectiveAspect,
              grid: true,
            }}
            transformImage={{
              adjustStencil: false,
              wheel: false,
            }}
            moveImage={{
              wheel: false,
            }}
            resizeImage={{
              wheel: false,
            }}
            className="cropper-instance"
          />

          <button
            className={`card-toggle ${expanded ? 'active' : ''}`}
            onClick={handleToggle}
            title="Image options"
          >
            <Settings size={14} />
          </button>

          <button
            className="card-delete"
            onClick={handleDelete}
            title="Remove image"
          >
            <X size={14} />
          </button>
        </div>

        <div className="card-filename" title={image.relativePath || image.name}>
          {image.name}
        </div>

        <div className={`card-footer ${expanded ? 'open' : ''}`}>
          <div className="footer-content">
            <div className="footer-section">
              <span className="footer-label">Aspect</span>
              <div className="aspect-pills">
                {ASPECT_PRESETS.map(({ label, value, icon: Icon }) => (
                  <button
                    key={label}
                    className={`aspect-pill ${localAspect === value ? 'active' : ''}`}
                    onClick={() => handleAspectChange(value)}
                    title={label}
                  >
                    <Icon size={12} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="footer-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResetCrop}
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
              <button
                className="btn btn-danger-ghost btn-sm"
                onClick={handleDelete}
              >
                <Trash2 size={12} />
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

ImageCard.displayName = 'ImageCard';
