import React, { memo, useCallback, useMemo, useState } from 'react';
import { AlertCircle, Check, RotateCcw, X } from 'lucide-react';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import {
  clampCornerRadiusToReference,
  clampPaddingToReference,
} from '../utils/boxValues';
import { computePaddedContentRect } from '../utils/paddedContentRect';
import type { GalleryImage } from '../types/app';
import { Skeleton } from './common/Skeleton';
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
    width,
    thumbnailSize = 384,
    selected,
    onSelect,
    isSingleEditMode = false,
  }: {
    image: GalleryImage;
    excluded?: boolean;
    onDelete: (id: string) => void;
    onRestore?: (id: string) => void;
    width: number;
    thumbnailSize?: number;
    selected: boolean;
    onSelect: (id: string | null) => void;
    isSingleEditMode?: boolean;
  }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const cropState = useStore(
      useCallback((state) => state.cropData.get(image.id), [image.id]),
    );
    const hasCaptionError = useStore(
      useCallback((state) => state.captionErrorById.has(image.id), [image.id]),
    );

    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const isInteracting = cropState?.isInteracting ?? false;
    const dynamicTransition =
      selected && !isInteracting
        ? 'all var(--transition-spring)'
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
      if (selected) return;
      onSelect(image.id);
    }, [image.id, onSelect, selected]);

    // Live Crop Visuals
    const coords = normalizeStoredCoordinates(cropState?.coordinates);
    const cw = coords?.width;
    const ch = coords?.height;
    const nw = Math.max(1, image.naturalWidth || 1);
    const nh = Math.max(1, image.naturalHeight || 1);
    const previewRotate = Number(transforms.rotate) || 0;

    const radians = (previewRotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const boxW = Math.max(1, nw * cos + nh * sin);
    const boxH = Math.max(1, nw * sin + nh * cos);

    const hasCoords = Boolean(coords && cw && ch && cw > 0 && ch > 0);
    const cropLeft = hasCoords ? Number(coords?.left) || 0 : 0;
    const cropTop = hasCoords ? Number(coords?.top) || 0 : 0;
    const cropW = hasCoords ? Number(cw) || 1 : boxW;
    const cropH = hasCoords ? Number(ch) || 1 : boxH;

    const cardHeight = (width / cropW) * cropH;

    const previewPadding = clampPaddingToReference(
      cropState?.padding || EMPTY_PADDING,
      boxW,
      boxH,
    );
    const contentRect = computePaddedContentRect(boxW, boxH, previewPadding);
    const previewScale = Math.max(1, width) / Math.max(1, cropW);
    
    const previewCornerRadius = clampCornerRadiusToReference(
      cropState?.cornerRadius || EMPTY_CORNER_RADIUS,
      contentRect.width,
      contentRect.height,
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
      if (effectivePreviewPaddingFillType === 'color') {
        return { background: previewPaddingFillValue };
      }
      if (effectivePreviewPaddingFillType === 'image' && previewPaddingImageUrl) {
        return {
          backgroundImage: `url(${previewPaddingImageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        };
      }
      return { background: 'transparent' };
    }, [effectivePreviewPaddingFillType, previewPaddingFillValue, previewPaddingImageUrl]);

    const wrapperW = (boxW / cropW) * 100;
    const wrapperH = (boxH / cropH) * 100;
    const wrapperLeft = -(cropLeft / cropW) * 100;
    const wrapperTop = -(cropTop / cropH) * 100;

    const imgW = (nw / boxW) * 100;
    const imgH = (nh / boxH) * 100;
    const imgLeft = ((boxW - nw) / 2) / boxW * 100;
    const imgTop = ((boxH - nh) / 2) / boxH * 100;

    const flipX = transforms.flip.horizontal ? -1 : 1;
    const flipY = transforms.flip.vertical ? -1 : 1;

    const previewImageSrc = useMemo(() => {
      const history = Array.isArray(cropState?.sourceEditHistory)
        ? (cropState?.sourceEditHistory as string[])
        : [];
      const historyIndexRaw = Number(cropState?.sourceEditHistoryIndex ?? -1);
      const historyIndex = Number.isFinite(historyIndexRaw)
        ? Math.trunc(historyIndexRaw)
        : -1;
      const activeEdited =
        historyIndex >= 0 && historyIndex < history.length ? history[historyIndex] : '';
      if (activeEdited) return activeEdited;

      if (!image.thumbnailUrl) return image.objectUrl;
      const safeThumbSize = Math.max(128, Math.round(Number(thumbnailSize || 384)));
      const separator = image.thumbnailUrl.includes('?') ? '&' : '?';
      return `${image.thumbnailUrl}${separator}thumbSize=${safeThumbSize}`;
    }, [cropState?.sourceEditHistory, cropState?.sourceEditHistoryIndex, image.objectUrl, image.thumbnailUrl, thumbnailSize]);

    return (
      <div
        className={`image-card ${selected ? 'selected' : ''} ${excluded ? 'is-excluded' : ''} ${isLoaded ? 'is-loaded' : ''}`}
        onClick={handleSelect}
        style={{ width, height: cardHeight }}
      >
        {!isLoaded && (
          <Skeleton 
            className="card-skeleton" 
            width="100%" 
            height="100%" 
            borderRadius="var(--radius-ui)"
          />
        )}
        
        <div
          className="card-preview transparency-grid"
          style={{
            width: '100%',
            height: '100%',
            opacity: isLoaded ? 1 : 0,
          }}
        >
          <div
            className="preview-content-root"
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              className="preview-rotated-wrapper"
              style={{
                position: 'absolute',
                width: `${wrapperW}%`,
                height: `${wrapperH}%`,
                left: `${wrapperLeft}%`,
                top: `${wrapperTop}%`,
                transition: dynamicTransition,
                ...previewPaddingBackgroundStyle,
              }}
            >
              <div
                className="preview-content-clip"
                style={{
                  position: 'absolute',
                  left: `${(contentRect.x / boxW) * 100}%`,
                  top: `${(contentRect.y / boxH) * 100}%`,
                  width: `${(contentRect.width / boxW) * 100}%`,
                  height: `${(contentRect.height / boxH) * 100}%`,
                  borderRadius: previewCornerRadiusCss,
                  overflow: 'hidden',
                }}
              >
                <div
                  className="preview-content-stage"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: `${100 / Math.max(0.0001, contentRect.scale)}%`,
                    height: `${100 / Math.max(0.0001, contentRect.scale)}%`,
                    transform: `translate(-50%, -50%) scale(${contentRect.scale})`,
                    transformOrigin: 'center',
                  }}
                >
                  <img
                    src={previewImageSrc}
                    alt={image.name}
                    onLoad={() => setIsLoaded(true)}
                    loading="lazy"
                    decoding="async"
                    {...({ fetchpriority: selected ? 'high' : 'low' } as Record<string, string>)}
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
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card-overlay">
            {!isSingleEditMode && (
              <button
                className={`card-delete ${excluded ? 'is-restore' : ''}`}
                onClick={handleDelete}
                title={excluded ? 'Restore image' : 'Remove image'}
              >
                {excluded ? <RotateCcw size={14} /> : <X size={14} />}
              </button>
            )}

            {selected && (
              <div className="selection-badge">
                <Check size={12} />
              </div>
            )}

            {hasCaptionError && (
              <div className="error-badge" title="AI captioning failed">
                <AlertCircle size={12} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

ImageCard.displayName = 'ImageCard';
