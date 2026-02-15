import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import useStore from '../store/useStore';
import './ImageCard.css';

export const ImageCard = memo(
  ({ image, onDelete, rowHeight, selected, onSelect, onCropChange }) => {
    const cropState = useStore((state) => state.cropData.get(image.id));

    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const handleDelete = (e) => {
      e.stopPropagation();
      onDelete(image.id);
    };

    // Live Crop Visuals
    const coords = cropState?.coordinates;
    const cw = coords?.width;
    const ch = coords?.height;

    // Transformed dimensions (iw/ih are the size of the image AFTER rotation/flip)
    const nw = image.naturalWidth;
    const nh = image.naturalHeight;
    const rotate = transforms.rotate || 0;

    // Use explicit trig to calculate the visual bounding box of the rotated image.
    // This is safer than relying on potentially stale or missing store data.
    const angle = (rotate * Math.PI) / 180;
    const iw = Math.abs(nw * Math.cos(angle)) + Math.abs(nh * Math.sin(angle));
    const ih = Math.abs(nw * Math.sin(angle)) + Math.abs(nh * Math.cos(angle));

    let cropWindowStyle = {};
    let imageStyle = {};

    if (coords && cw && ch && iw && ih) {
      // 1. Zoom is based on transformed image vs crop width
      const zoom = (iw / cw) * 100;

      cropWindowStyle = {
        width: `${zoom}%`,
        position: 'absolute',
        top: 0,
        left: 0,
        // Move the window so the crop area is at 0,0
        transform: `translate(${-(coords.left / iw) * 100}%, ${-(coords.top / ih) * 100}%)`,
        transformOrigin: 'top left',
      };

      // 2. The image inside the window needs correct sizing to handle rotation
      // The container is iw x ih (the size of the rotated image)
      // The image is nw x nh (the natural size)
      // So width = (nw / iw) * 100%
      // Height = (nh / ih) * 100%

      const isRotated = transforms.rotate % 180 !== 0;
      imageStyle = {
        // If rotated 90deg, the image's "width" aligns with container's "height"
        // But the container is iw x ih.
        // We want the image to be nw x nh (unrotated size).
        // So width = (nw / iw) * 100%
        // Height = (nh / ih) * 100%
        width: `${(nw / iw) * 100}%`,
        height: `${(nh / ih) * 100}%`,
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `
          translate(-50%, -50%)
          rotate(${transforms.rotate}deg) 
          scaleX(${transforms.flip.horizontal ? -1 : 1}) 
          scaleY(${transforms.flip.vertical ? -1 : 1})
        `,
        objectFit: 'cover',
      };
    } else {
      cropWindowStyle = { width: '100%', height: '100%' };
      imageStyle = {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `
          rotate(${transforms.rotate}deg) 
          scaleX(${transforms.flip.horizontal ? -1 : 1}) 
          scaleY(${transforms.flip.vertical ? -1 : 1})
        `,
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      };
    }

    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={`image-card ${selected ? 'selected' : ''}`}
        onClick={onSelect}
      >
        <div
          className="card-preview"
          style={{
            height: rowHeight,
            overflow: 'hidden',
            position: 'relative',
            aspectRatio:
              cw && ch
                ? `${cw} / ${ch}`
                : transforms.rotate % 180 === 90
                  ? `${nh} / ${nw}`
                  : `${nw} / ${nh}`,
          }}
        >
          <div className="crop-window" style={cropWindowStyle}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: `${iw} / ${ih}`,
                overflow: 'visible',
              }}
            >
              <img
                src={image.objectUrl}
                alt={image.name}
                style={imageStyle}
                className="preview-image"
              />
            </div>
          </div>

          <div className="card-overlay">
            <button
              className="card-delete"
              onClick={handleDelete}
              title="Remove image"
            >
              <X size={14} />
            </button>

            {selected && (
              <div className="selection-badge">
                <Check size={12} />
              </div>
            )}
          </div>
        </div>

        <div className="card-info">
          <div
            className="card-filename"
            title={image.relativePath || image.name}
          >
            {image.name}
          </div>
          <div className="card-dimensions">
            {image.naturalWidth} × {image.naturalHeight}
          </div>
        </div>
      </motion.div>
    );
  },
);
ImageCard.displayName = 'ImageCard';
