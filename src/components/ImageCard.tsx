import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import type {
  CornerRadiusValues,
  CropEntry,
  GalleryImage,
  PaddingValues,
} from '../types/app';
import './ImageCard.css';

const MAX_TRANSFORM_PREVIEW_DIM = 1536;
const EMPTY_PADDING = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const EMPTY_CORNER_RADIUS = Object.freeze({
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
});
const DEFAULT_PADDING_FILL_VALUE = '#ffffff';
const MAX_PADDING_PX = 640;
const MAX_CORNER_RADIUS_PX = 360;
const INNER_PADDING_SIDE_RATIO = 0.4;
const OUTER_PADDING_SIDE_RATIO = 0.75;

const normalizePaddingFillType = (value: unknown): 'empty' | 'color' | 'image' => {
  if (value === 'color' || value === 'image') return value;
  return 'empty';
};

const clampPaddingValue = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

const normalizePadding = (
  padding: Partial<PaddingValues> | string | null | undefined,
): PaddingValues => ({
  top: clampPaddingValue(
    Number((padding && typeof padding === 'object' ? padding.top : 0) ?? 0),
  ),
  right: clampPaddingValue(
    Number((padding && typeof padding === 'object' ? padding.right : 0) ?? 0),
  ),
  bottom: clampPaddingValue(
    Number((padding && typeof padding === 'object' ? padding.bottom : 0) ?? 0),
  ),
  left: clampPaddingValue(
    Number((padding && typeof padding === 'object' ? padding.left : 0) ?? 0),
  ),
});

const clampPaddingByMode = (
  padding: Partial<PaddingValues> | string | null | undefined,
  mode: 'inner' | 'outer',
  referenceWidth: number,
  referenceHeight: number,
): PaddingValues => {
  const normalized = normalizePadding(padding);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const ratio =
    mode === 'outer' ? OUTER_PADDING_SIDE_RATIO : INNER_PADDING_SIDE_RATIO;
  const horizontalCap = Math.max(
    0,
    Math.min(MAX_PADDING_PX, Math.round(safeWidth * ratio)),
  );
  const verticalCap = Math.max(
    0,
    Math.min(MAX_PADDING_PX, Math.round(safeHeight * ratio)),
  );

  return {
    top: Math.min(normalized.top, verticalCap),
    right: Math.min(normalized.right, horizontalCap),
    bottom: Math.min(normalized.bottom, verticalCap),
    left: Math.min(normalized.left, horizontalCap),
  };
};

const normalizeCornerRadius = (
  radius: Partial<CornerRadiusValues> | string | null | undefined,
): CornerRadiusValues => ({
  topLeft: clampPaddingValue(
    Number((radius && typeof radius === 'object' ? radius.topLeft : 0) ?? 0),
  ),
  topRight: clampPaddingValue(
    Number((radius && typeof radius === 'object' ? radius.topRight : 0) ?? 0),
  ),
  bottomRight: clampPaddingValue(
    Number((radius && typeof radius === 'object' ? radius.bottomRight : 0) ?? 0),
  ),
  bottomLeft: clampPaddingValue(
    Number((radius && typeof radius === 'object' ? radius.bottomLeft : 0) ?? 0),
  ),
});

const clampCornerRadiusByReference = (
  radius: Partial<CornerRadiusValues> | string | null | undefined,
  referenceWidth: number,
  referenceHeight: number,
): CornerRadiusValues => {
  const normalized = normalizeCornerRadius(radius);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const maxRadius = Math.max(
    0,
    Math.min(
      MAX_CORNER_RADIUS_PX,
      Math.round(Math.min(safeWidth, safeHeight) * 0.5),
    ),
  );

  return {
    topLeft: Math.min(normalized.topLeft, maxRadius),
    topRight: Math.min(normalized.topRight, maxRadius),
    bottomRight: Math.min(normalized.bottomRight, maxRadius),
    bottomLeft: Math.min(normalized.bottomLeft, maxRadius),
  };
};

export const ImageCard = memo(
  ({
    image,
    onDelete,
    rowHeight,
    thumbnailSize = 320,
    selected,
    onSelect,
    disableLayoutAnimation = false,
  }: {
    image: GalleryImage;
    onDelete: (id: string) => void;
    rowHeight: number;
    thumbnailSize?: number;
    selected: boolean;
    onSelect: (id: string | null) => void;
    disableLayoutAnimation?: boolean;
  }) => {
    const cropState = useStore(
      useCallback((state) => state.cropData.get(image.id), [image.id]),
    );

    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const isInteracting = cropState?.isInteracting ?? false;
    const dynamicTransition = isInteracting ? 'none' : 'all var(--transition-spring)';

    const handleDelete = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onDelete(image.id);
    };

    const handleSelect = useCallback(() => {
      onSelect(selected ? null : image.id);
    }, [image.id, onSelect, selected]);

    // Live Crop Visuals
    const coords = normalizeStoredCoordinates(cropState?.coordinates);
    const cw = coords?.width;
    const ch = coords?.height;
    const previewPaddingMode =
      cropState?.paddingMode === 'outer' ? 'outer' : 'inner';
    const previewReferenceWidth = Math.max(
      1,
      Number(cw ?? image.naturalWidth ?? 1) || 1,
    );
    const previewReferenceHeight = Math.max(
      1,
      Number(ch ?? image.naturalHeight ?? 1) || 1,
    );
    const previewPadding = clampPaddingByMode(
      cropState?.padding || EMPTY_PADDING,
      previewPaddingMode,
      previewReferenceWidth,
      previewReferenceHeight,
    );
    const previewPaddingCss = `${previewPadding.top}px ${previewPadding.right}px ${previewPadding.bottom}px ${previewPadding.left}px`;
    const previewCornerRadius = clampCornerRadiusByReference(
      cropState?.cornerRadius || EMPTY_CORNER_RADIUS,
      previewReferenceWidth,
      previewReferenceHeight,
    );
    const previewCornerRadiusCss = `${previewCornerRadius.topLeft}px ${previewCornerRadius.topRight}px ${previewCornerRadius.bottomRight}px ${previewCornerRadius.bottomLeft}px`;
    const hasPreviewPadding =
      previewPadding.top > 0 ||
      previewPadding.right > 0 ||
      previewPadding.bottom > 0 ||
      previewPadding.left > 0;
    const previewPaddingFillType = normalizePaddingFillType(
      cropState?.paddingFillType,
    );
    const previewPaddingFillValue =
      typeof cropState?.paddingFillValue === 'string' &&
      cropState.paddingFillValue.trim() !== ''
        ? cropState.paddingFillValue
        : DEFAULT_PADDING_FILL_VALUE;
    const previewPaddingImageUrl =
      typeof cropState?.paddingImageUrl === 'string'
        ? cropState.paddingImageUrl
        : '';
    const previewPaddingBackgroundStyle = useMemo(() => {
      if (!hasPreviewPadding) {
        return undefined;
      }

      if (previewPaddingFillType === 'color') {
        return {
          background: previewPaddingFillValue,
        };
      }

      if (previewPaddingFillType === 'image' && previewPaddingImageUrl) {
        return {
          backgroundImage: `url(${previewPaddingImageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        };
      }

      return {
        background: 'var(--bg-elevated)',
      };
    }, [
      hasPreviewPadding,
      previewPaddingFillType,
      previewPaddingFillValue,
      previewPaddingImageUrl,
    ]);

    // CSS Math for precise crop preview mapping
    const nw = Math.max(1, image.naturalWidth || 1);
    const nh = Math.max(1, image.naturalHeight || 1);
    const previewRotate = Number(transforms.rotate) || 0;
    
    // 1. Calculate the bounding box of the rotated original image
    const radians = (previewRotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const boxW = Math.max(1, nw * cos + nh * sin);
    const boxH = Math.max(1, nw * sin + nh * cos);

    // 2. Fetch the crop coordinates. 
    // If no crop is set, the crop box IS the rotated bounding box.
    const hasCoords = Boolean(coords && cw && ch && cw > 0 && ch > 0);
    const cropLeft = hasCoords ? Number(coords?.left) || 0 : 0;
    const cropTop = hasCoords ? Number(coords?.top) || 0 : 0;
    const cropW = hasCoords ? Number(cw) || 1 : boxW;
    const cropH = hasCoords ? Number(ch) || 1 : boxH;

    // 3. Aspect ratio for the grid container
    const previewAspectRatio = `${cropW} / ${cropH}`;

    // 4. Calculate wrapper percentages
    // The wrapper represents the rotated bounding box scaled relative to the crop viewport
    const wrapperW = (boxW / cropW) * 100;
    const wrapperH = (boxH / cropH) * 100;
    const wrapperLeft = -(cropLeft / cropW) * 100;
    const wrapperTop = -(cropTop / cropH) * 100;

    // 5. Calculate inner image percentages
    // The image is centered inside the wrapper and maintains its natural proportions
    const imgW = (nw / boxW) * 100;
    const imgH = (nh / boxH) * 100;
    const imgLeft = ((boxW - nw) / 2) / boxW * 100;
    const imgTop = ((boxH - nh) / 2) / boxH * 100;

    const flipX = transforms.flip.horizontal ? -1 : 1;
    const flipY = transforms.flip.vertical ? -1 : 1;
    const previewImageSrc = useMemo(() => {
      if (!image.thumbnailUrl) return image.objectUrl;
      const safeThumbSize = Math.max(96, Math.round(Number(thumbnailSize || 320)));
      const separator = image.thumbnailUrl.includes('?') ? '&' : '?';
      return `${image.thumbnailUrl}${separator}thumbSize=${safeThumbSize}`;
    }, [image.objectUrl, image.thumbnailUrl, thumbnailSize]);


    return (
      <motion.div
        layout={!disableLayoutAnimation}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={`image-card ${selected ? 'selected' : ''}`}
        onClick={handleSelect}
      >
        <div
          className="card-preview"
          style={{
            height: rowHeight,
            position: 'relative',
            aspectRatio: previewAspectRatio,
          }}
        >
          <div
            className={`preview-padding-shell ${hasPreviewPadding ? 'has-padding' : ''}`}
            style={{
              padding: previewPaddingCss,
              ...(previewPaddingBackgroundStyle || {}),
            }}
          >
            <div
              className="preview-padding-content"
              style={{ 
                 borderRadius: previewCornerRadiusCss,
                 position: 'relative',
                 width: '100%',
                 height: '100%',
                 overflow: 'hidden'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: `${wrapperW}%`,
                  height: `${wrapperH}%`,
                  left: `${wrapperLeft}%`,
                  top: `${wrapperTop}%`,
                  transformOrigin: '0 0',
                  transition: dynamicTransition,
                  willChange: 'width, height, left, top',
                  pointerEvents: 'none' // allow clicks to pass through
                }}
              >
                <img
                  src={previewImageSrc}
                  alt={image.name}
                  loading="lazy"
                  decoding="async"
                  fetchPriority={selected ? 'high' : 'low'}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: `${imgW}%`,
                    height: `${imgH}%`,
                    left: `${imgLeft}%`,
                    top: `${imgTop}%`,
                    transform: `rotate(${previewRotate}deg) scaleX(${flipX}) scaleY(${flipY})`,
                    transformOrigin: 'center center',
                    objectFit: 'fill',
                    transition: dynamicTransition,
                    willChange: 'width, height, left, top, transform',
                    pointerEvents: 'none'
                  }}
                />
              </div>
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

      </motion.div>
    );
  },
);
ImageCard.displayName = 'ImageCard';
