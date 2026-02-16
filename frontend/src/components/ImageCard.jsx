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
import useStore from '../store/useStore';
import './ImageCard.css';

const MAX_TRANSFORM_PREVIEW_DIM = 2048;
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

const normalizePaddingFillType = (value) => {
  if (value === 'color' || value === 'image') return value;
  return 'empty';
};

const clampPaddingValue = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

const normalizePadding = (padding) => ({
  top: clampPaddingValue(Number(padding?.top ?? 0)),
  right: clampPaddingValue(Number(padding?.right ?? 0)),
  bottom: clampPaddingValue(Number(padding?.bottom ?? 0)),
  left: clampPaddingValue(Number(padding?.left ?? 0)),
});

const normalizeCornerRadius = (radius) => ({
  topLeft: clampPaddingValue(Number(radius?.topLeft ?? 0)),
  topRight: clampPaddingValue(Number(radius?.topRight ?? 0)),
  bottomRight: clampPaddingValue(Number(radius?.bottomRight ?? 0)),
  bottomLeft: clampPaddingValue(Number(radius?.bottomLeft ?? 0)),
});

export const ImageCard = memo(
  ({ image, onDelete, rowHeight, selected, onSelect }) => {
    const cropState = useStore((state) => state.cropData.get(image.id));
    const previewCanvasRef = useRef(null);
    const transformedCanvasRef = useRef(null);
    const transformedMetaRef = useRef({
      scale: 1,
      boxW: image.naturalWidth || 1,
      boxH: image.naturalHeight || 1,
    });
    const drawRafRef = useRef(0);
    const drawPreviewRef = useRef(() => {});
    const [isCanvasReady, setIsCanvasReady] = useState(false);

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
    const previewPadding = normalizePadding(cropState?.padding || EMPTY_PADDING);
    const previewPaddingCss = `${previewPadding.top}px ${previewPadding.right}px ${previewPadding.bottom}px ${previewPadding.left}px`;
    const previewCornerRadius = normalizeCornerRadius(
      cropState?.cornerRadius || EMPTY_CORNER_RADIUS,
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

    // Transformed dimensions (iw/ih are the size of the image AFTER rotation/flip)
    const nw = image.naturalWidth;
    const nh = image.naturalHeight;
    const rotate = transforms.rotate || 0;
    const angle = (rotate * Math.PI) / 180;
    const transformedW =
      Math.abs(nw * Math.cos(angle)) + Math.abs(nh * Math.sin(angle));
    const transformedH =
      Math.abs(nw * Math.sin(angle)) + Math.abs(nh * Math.cos(angle));

    const hasCoords = Boolean(coords && cw > 0 && ch > 0);
    const previewAspectRatio = useMemo(() => {
      if (hasCoords) return `${cw} / ${ch}`;
      const safeW = Math.max(1, transformedW || nw || 1);
      const safeH = Math.max(1, transformedH || nh || 1);
      return `${safeW} / ${safeH}`;
    }, [hasCoords, cw, ch, transformedW, transformedH, nw, nh]);

    const drawPreview = useCallback(() => {
      const previewCanvas = previewCanvasRef.current;
      const transformedCanvas = transformedCanvasRef.current;
      const meta = transformedMetaRef.current;
      if (!previewCanvas || !transformedCanvas) return;

      const sourceW = hasCoords ? cw : meta.boxW || transformedW || nw || 1;
      const sourceH = hasCoords ? ch : meta.boxH || transformedH || nh || 1;
      if (!sourceW || !sourceH) return;

      const dpr =
        typeof window !== 'undefined' && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1;
      const targetH = Math.max(1, Math.round(rowHeight * dpr));
      const targetW = Math.max(1, Math.round((sourceW / sourceH) * targetH));

      if (
        previewCanvas.width !== targetW ||
        previewCanvas.height !== targetH
      ) {
        previewCanvas.width = targetW;
        previewCanvas.height = targetH;
      }

      const ctx = previewCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, targetW, targetH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      let sx = hasCoords ? coords.left * meta.scale : 0;
      let sy = hasCoords ? coords.top * meta.scale : 0;
      let sw = hasCoords ? sourceW * meta.scale : transformedCanvas.width;
      let sh = hasCoords ? sourceH * meta.scale : transformedCanvas.height;

      if (
        !Number.isFinite(sx) ||
        !Number.isFinite(sy) ||
        !Number.isFinite(sw) ||
        !Number.isFinite(sh)
      ) {
        return;
      }

      sx = Math.max(0, Math.min(sx, transformedCanvas.width - 1));
      sy = Math.max(0, Math.min(sy, transformedCanvas.height - 1));
      sw = Math.max(1, Math.min(sw, transformedCanvas.width - sx));
      sh = Math.max(1, Math.min(sh, transformedCanvas.height - sy));

      ctx.drawImage(transformedCanvas, sx, sy, sw, sh, 0, 0, targetW, targetH);
      setIsCanvasReady(true);
    }, [coords, hasCoords, cw, ch, rowHeight, transformedW, transformedH, nw, nh]);

    useEffect(() => {
      drawPreviewRef.current = drawPreview;
    }, [drawPreview]);

    useEffect(() => {
      let cancelled = false;
      setIsCanvasReady(false);

      const buildTransformedCanvas = async () => {
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = image.objectUrl;
            if (img.complete && img.naturalWidth > 0) {
              resolve();
            }
          });
          if (img.decode) {
            try {
              await img.decode();
            } catch {
              // ignore decode errors; onload already guarantees drawable pixels
            }
          }
          if (cancelled) return;

          const baseW = img.naturalWidth || nw || 1;
          const baseH = img.naturalHeight || nh || 1;
          const rads = (rotate * Math.PI) / 180;
          const boxW =
            Math.abs(baseW * Math.cos(rads)) + Math.abs(baseH * Math.sin(rads));
          const boxH =
            Math.abs(baseW * Math.sin(rads)) + Math.abs(baseH * Math.cos(rads));
          const scale = Math.max(
            0.05,
            Math.min(1, MAX_TRANSFORM_PREVIEW_DIM / Math.max(1, boxW, boxH)),
          );

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(boxW * scale));
          canvas.height = Math.max(1, Math.round(boxH * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(rads);
          ctx.scale(
            transforms.flip.horizontal ? -1 : 1,
            transforms.flip.vertical ? -1 : 1,
          );
          ctx.drawImage(
            img,
            -((baseW * scale) / 2),
            -((baseH * scale) / 2),
            baseW * scale,
            baseH * scale,
          );
          ctx.restore();

          transformedCanvasRef.current = canvas;
          transformedMetaRef.current = { scale, boxW, boxH };

          if (drawRafRef.current) {
            cancelAnimationFrame(drawRafRef.current);
          }
          drawRafRef.current = requestAnimationFrame(() => {
            drawRafRef.current = 0;
            drawPreviewRef.current();
          });
        } catch {
          transformedCanvasRef.current = null;
          setIsCanvasReady(false);
        }
      };

      buildTransformedCanvas();

      return () => {
        cancelled = true;
      };
    }, [
      image.objectUrl,
      rotate,
      transforms.flip.horizontal,
      transforms.flip.vertical,
      nw,
      nh,
    ]);

    useEffect(() => {
      if (drawRafRef.current) {
        cancelAnimationFrame(drawRafRef.current);
      }
      drawRafRef.current = requestAnimationFrame(() => {
        drawRafRef.current = 0;
        drawPreview();
      });
      return () => {
        if (drawRafRef.current) {
          cancelAnimationFrame(drawRafRef.current);
          drawRafRef.current = 0;
        }
      };
    }, [drawPreview]);

    useEffect(
      () => () => {
        if (drawRafRef.current) {
          cancelAnimationFrame(drawRafRef.current);
          drawRafRef.current = 0;
        }
        transformedCanvasRef.current = null;
      },
      [],
    );

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
              style={{ borderRadius: previewCornerRadiusCss }}
            >
              <img
                src={image.objectUrl}
                alt={image.name}
                className={`preview-image preview-image--fallback ${
                  isCanvasReady ? 'hidden' : ''
                }`}
              />
              <canvas
                ref={previewCanvasRef}
                className={`preview-image preview-image--canvas ${
                  isCanvasReady ? 'visible' : ''
                }`}
                aria-label={image.name}
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

      </motion.div>
    );
  },
);
ImageCard.displayName = 'ImageCard';
