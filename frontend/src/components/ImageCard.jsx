import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import './ImageCard.css';

export const ImageCard = memo(
  ({ image, cropState, onDelete, rowHeight, selected, onSelect }) => {
    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const handleDelete = (e) => {
      e.stopPropagation();
      onDelete(image.id);
    };

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
        <div className="card-preview" style={{ height: rowHeight }}>
          <img
            src={image.objectUrl}
            alt={image.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `
                rotate(${transforms.rotate}deg) 
                scaleX(${transforms.flip.horizontal ? -1 : 1}) 
                scaleY(${transforms.flip.vertical ? -1 : 1})
              `,
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />

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
