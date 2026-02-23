import React, { memo, useCallback, useMemo } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import {
  clampCornerRadiusToReference,
  clampPaddingToReference,
} from '../utils/boxValues';
import type { GalleryImage } from '../types/app';
import './ImageCard.css';
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

const normalizePaddingFillType = (value: unknown): 'empty' | 'color' | 'image' => {
  if (value === 'color' || value === 'image') return value;
  return 'empty';
};

const formatPreviewPx = (value: number): string => {
  const safe = Math.max(0, Number(value) || 0);
  if (safe <= 0.0001) return '0px';
  const rounded = Math.round(safe * 1000) / 1000;
  return `${String(rounded).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}px`;
};

export const ImageCard = memo(
  ({
    image,
    excluded = false,
    onDelete,
    onRestore,
    rowHeight,
    thumbnailSize = 320,
    selected,
    onSelect,
  }: {
    image: GalleryImage;
    excluded?: boolean;
    onDelete: (id: string) => void;
    onRestore?: (id: string) => void;
    rowHeight: number;
    thumbnailSize?: number;
    selected: boolean;
    onSelect: (id: string | null) => void;
  }) => {
    const cropState = useStore(
      useCallback((state) => state.cropData.get(image.id), [image.id]),
    );

    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const isInteracting = cropState?.isInteracting ?? false;
    const dynamicTransition =
      selected && !isInteracting
        ? 'width var(--transition-spring), height var(--transition-spring), left var(--transition-spring), top var(--transition-spring), transform var(--transition-spring)'
        : 'none';

    const handleDelete = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (excluded) {
        onRestore?.(image.id);
        return;
      }
      onDelete(image.id);
    };

    const handleSelect = useCallback(() => {
      if (excluded) return;
      onSelect(selected ? null : image.id);
    }, [excluded, image.id, onSelect, selected]);

    // Live Crop Visuals
    const coords = normalizeStoredCoordinates(cropState?.coordinates);
    const cw = coords?.width;
    const ch = coords?.height;
    const nw = Math.max(1, image.naturalWidth || 1);
    const nh = Math.max(1, image.naturalHeight || 1);
    const previewRotate = Number(transforms.rotate) || 0;

    // 1. Calculate the bounding box of the rotated original image.
    const radians = (previewRotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const boxW = Math.max(1, nw * cos + nh * sin);
    const boxH = Math.max(1, nw * sin + nh * cos);

    // 2. Fetch the crop coordinates.
    // If no crop is set, the crop box is the rotated bounding box.
    const hasCoords = Boolean(coords && cw && ch && cw > 0 && ch > 0);
    const cropLeft = hasCoords ? Number(coords?.left) || 0 : 0;
    const cropTop = hasCoords ? Number(coords?.top) || 0 : 0;
    const cropW = hasCoords ? Number(cw) || 1 : boxW;
    const cropH = hasCoords ? Number(ch) || 1 : boxH;

    const previewPadding = clampPaddingToReference(
      cropState?.padding || EMPTY_PADDING,
      cropW,
      cropH,
    );
    const hasPreviewPadding =
      previewPadding.top > 0 ||
      previewPadding.right > 0 ||
      previewPadding.bottom > 0 ||
      previewPadding.left > 0;
    const previewScale = Math.max(1, Number(rowHeight) || 1) / Math.max(1, cropH);
    const scaledPreviewPadding = {
      top: previewPadding.top * previewScale,
      right: previewPadding.right * previewScale,
      bottom: previewPadding.bottom * previewScale,
      left: previewPadding.left * previewScale,
    };
    const previewPaddingCss = `${formatPreviewPx(scaledPreviewPadding.top)} ${formatPreviewPx(
      scaledPreviewPadding.right,
    )} ${formatPreviewPx(scaledPreviewPadding.bottom)} ${formatPreviewPx(
      scaledPreviewPadding.left,
    )}`;
    const previewCornerRadius = clampCornerRadiusToReference(
      cropState?.cornerRadius || EMPTY_CORNER_RADIUS,
      cropW,
      cropH,
    );
    const scaledPreviewCornerRadius = {
      topLeft: previewCornerRadius.topLeft * previewScale,
      topRight: previewCornerRadius.topRight * previewScale,
      bottomRight: previewCornerRadius.bottomRight * previewScale,
      bottomLeft: previewCornerRadius.bottomLeft * previewScale,
    };
    const previewCornerRadiusCss = `${formatPreviewPx(
      scaledPreviewCornerRadius.topLeft,
    )} ${formatPreviewPx(scaledPreviewCornerRadius.topRight)} ${formatPreviewPx(
      scaledPreviewCornerRadius.bottomRight,
    )} ${formatPreviewPx(scaledPreviewCornerRadius.bottomLeft)}`;
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
        ? cropState.paddingImageUrl.trim()
        : '';
    const effectivePreviewPaddingFillType =
      previewPaddingFillType === 'image' && !previewPaddingImageUrl
        ? 'empty'
        : previewPaddingFillType;
    const previewPaddingBackgroundStyle = useMemo(() => {
      if (!hasPreviewPadding) {
        return undefined;
      }

      if (effectivePreviewPaddingFillType === 'color') {
        return {
          background: previewPaddingFillValue,
        };
      }

      if (effectivePreviewPaddingFillType === 'image' && previewPaddingImageUrl) {
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
      effectivePreviewPaddingFillType,
      previewPaddingFillValue,
      previewPaddingImageUrl,
    ]);

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
      <div
        className={`image-card ${selected ? 'selected' : ''} ${excluded ? 'is-excluded' : ''}`}
        onClick={handleSelect}
        aria-disabled={excluded}
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
                  willChange: selected ? 'width, height, left, top' : undefined,
                  pointerEvents: 'none' // allow clicks to pass through
                }}
              >
                <img
                  src={previewImageSrc}
                  alt={image.name}
                  loading="lazy"
                  decoding="async"
                  {...({
                    fetchpriority: selected ? 'high' : 'low',
                  } as Record<string, string>)}
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
                    willChange: selected ? 'width, height, left, top, transform' : undefined,
                    pointerEvents: 'none'
                  }}
                />
              </div>
            </div>
          </div>

          <div className="card-overlay">
            <button
              className={`card-delete ${excluded ? 'is-restore' : ''}`}
              onClick={handleDelete}
              title={excluded ? 'Restore image' : 'Remove image'}
            >
              {excluded ? <RotateCcw size={14} /> : <X size={14} />}
            </button>

            {selected && (
              <div className="selection-badge">
                <Check size={12} />
              </div>
            )}
          </div>
        </div>

      </div>
    );
  },
);
ImageCard.displayName = 'ImageCard';
