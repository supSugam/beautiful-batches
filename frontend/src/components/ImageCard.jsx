import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
} from 'react';
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
  RotateCw,
  FlipHorizontal,
  FlipVertical,
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
  ({ image, cropState, onCropChange, onDelete, rowHeight, showAllFooters }) => {
    const [expanded, setExpanded] = useState(showAllFooters);
    const [localAspect, setLocalAspect] = useState(undefined);
    const cropperRef = useRef(null);
    const wrapperRef = useRef(null);

    // Sync with global toggle
    useEffect(() => {
      setExpanded(showAllFooters);
    }, [showAllFooters]);
    const effectiveAspect = useMemo(() => {
      const rotation = Math.abs((cropState?.transforms?.rotate || 0) % 360);
      const isRotated = rotation % 180 === 90;

      if (localAspect === null) return null;
      if (localAspect !== undefined) {
        return isRotated ? 1 / localAspect : localAspect;
      }

      let ratio = image.naturalRatio || 1;
      return isRotated ? 1 / ratio : ratio;
    }, [image.naturalRatio, localAspect, cropState]);

    // Initialize transforms from props if available
    const defaultTransforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const handleCropEnd = useCallback(() => {
      if (!cropperRef.current) return;
      const coords = cropperRef.current.getCoordinates();
      const transforms = cropperRef.current.getTransforms();

      if (coords) {
        onCropChange(image.id, { coordinates: coords, transforms });
      }
    }, [image.id, onCropChange]);

    // Force refresh when row height changes
    useEffect(() => {
      if (cropperRef.current) {
        cropperRef.current.refresh();
      }
    }, [rowHeight]);

    // Robust fix: Stop wheel events from reaching the Cropper
    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const handleWheel = (e) => {
        e.stopPropagation();
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
        // Reset transforms too
        // React Advanced Cropper reset() might not reset transforms unless configured?
        // Actually reset() resets everything usually.
        setTimeout(() => {
          const coords = cropperRef.current?.getCoordinates();
          const transforms = cropperRef.current?.getTransforms();
          if (coords)
            onCropChange(image.id, { coordinates: coords, transforms });
        }, 50);
      }
      setLocalAspect(undefined);
    }, [image.id, onCropChange]);

    const handleAspectChange = useCallback((value) => {
      setLocalAspect(value);
    }, []);

    const handleRotate = useCallback(() => {
      if (cropperRef.current) {
        cropperRef.current.rotateImage(90);
        handleCropEnd(); // Save state
      }
    }, [handleCropEnd]);

    const handleFlip = useCallback(
      (horizontal) => {
        if (cropperRef.current) {
          const state = cropperRef.current.getState();
          const rotate = Math.abs((state?.transforms?.rotate || 0) % 360);

          // Determine if we need to swap axes based on rotation
          // At 90/270 degrees, the V-axis of the screen is the H-axis of the image
          const isSwapped = rotate % 180 === 90;

          const flipToggle = {
            horizontal: isSwapped ? !horizontal : horizontal,
            vertical: isSwapped ? horizontal : !horizontal,
          };

          cropperRef.current.transformImage(
            { flip: flipToggle },
            { adjustStencil: false },
          );
          handleCropEnd();
        }
      },
      [handleCropEnd],
    );

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
            defaultTransforms={defaultTransforms}
            transformImage={{
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
            {/* Aspect Ratio Section */}
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

            {/* Transform Section */}
            <div className="footer-section">
              <span className="footer-label">Transform</span>
              <div className="transform-actions">
                <button
                  className="aspect-pill"
                  onClick={handleRotate}
                  title="Rotate 90°"
                >
                  <RotateCw size={12} />
                  <span>Rotate</span>
                </button>
                <button
                  className="aspect-pill"
                  onClick={() => handleFlip(true)}
                  title="Flip Horizontal"
                >
                  <FlipHorizontal size={12} />
                  <span>Flip H</span>
                </button>
                <button
                  className="aspect-pill"
                  onClick={() => handleFlip(false)}
                  title="Flip Vertical"
                >
                  <FlipVertical size={12} />
                  <span>Flip V</span>
                </button>
              </div>
            </div>

            <div className="footer-divider" />

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
