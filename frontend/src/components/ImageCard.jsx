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
const PREVIEW_ROTATE_STEP = 0.5;
const MAX_PADDING_PX = 640;
const MAX_CORNER_RADIUS_PX = 360;
const INNER_PADDING_SIDE_RATIO = 0.4;
const OUTER_PADDING_SIDE_RATIO = 0.75;

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

const clampPaddingByMode = (padding, mode, referenceWidth, referenceHeight) => {
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

const normalizeCornerRadius = (radius) => ({
  topLeft: clampPaddingValue(Number(radius?.topLeft ?? 0)),
  topRight: clampPaddingValue(Number(radius?.topRight ?? 0)),
  bottomRight: clampPaddingValue(Number(radius?.bottomRight ?? 0)),
  bottomLeft: clampPaddingValue(Number(radius?.bottomLeft ?? 0)),
});

const clampCornerRadiusByReference = (radius, referenceWidth, referenceHeight) => {
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
    selected,
    onSelect,
    disableLayoutAnimation = false,
  }) => {
    const cropState = useStore((state) => state.cropData.get(image.id));
    const previewCanvasRef = useRef(null);
    const transformedCanvasRef = useRef(null);
    const sourceImageRef = useRef(null);
    const transformedMetaRef = useRef({
      scale: 1,
      boxW: image.naturalWidth || 1,
      boxH: image.naturalHeight || 1,
    });
    const drawRafRef = useRef(0);
    const transformRafRef = useRef(0);
    const drawPreviewRef = useRef(() => {});
    const [isCanvasReady, setIsCanvasReady] = useState(false);
    const [sourceImageVersion, setSourceImageVersion] = useState(0);

    const transforms = cropState?.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };

    const handleDelete = (e) => {
      e.stopPropagation();
      onDelete(image.id);
    };

    const handleSelect = useCallback(() => {
      onSelect(selected ? null : image.id);
    }, [image.id, onSelect, selected]);

    // Live Crop Visuals
    const coords = cropState?.coordinates;
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

    // Transformed dimensions (iw/ih are the size of the image AFTER rotation/flip)
    const nw = image.naturalWidth;
    const nh = image.naturalHeight;
    const rotate = transforms.rotate || 0;
    const previewRotate =
      Math.round(rotate / PREVIEW_ROTATE_STEP) * PREVIEW_ROTATE_STEP;
    const hasTransformPreview =
      Math.abs(previewRotate) > 0.0001 ||
      transforms.flip.horizontal ||
      transforms.flip.vertical;
    const angle = (previewRotate * Math.PI) / 180;
    const transformedW =
      Math.abs(nw * Math.cos(angle)) + Math.abs(nh * Math.sin(angle));
    const transformedH =
      Math.abs(nw * Math.sin(angle)) + Math.abs(nh * Math.cos(angle));

    const hasCoords = Boolean(coords && cw > 0 && ch > 0);
    const requiresCanvasPreview = hasCoords || hasTransformPreview;
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
      if (!requiresCanvasPreview || !previewCanvas || !transformedCanvas) return;

      const sourceW = hasCoords ? cw : meta.boxW || transformedW || nw || 1;
      const sourceH = hasCoords ? ch : meta.boxH || transformedH || nh || 1;
      if (!sourceW || !sourceH) return;

      const dpr =
        typeof window !== 'undefined' && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1;
      const effectiveDpr = Math.min(1.5, dpr);
      const targetH = Math.max(1, Math.round(rowHeight * effectiveDpr));
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
    }, [
      coords,
      hasCoords,
      cw,
      ch,
      rowHeight,
      transformedW,
      transformedH,
      nw,
      nh,
      requiresCanvasPreview,
    ]);

    useEffect(() => {
      drawPreviewRef.current = drawPreview;
    }, [drawPreview]);

    useEffect(() => {
      if (!requiresCanvasPreview) {
        setIsCanvasReady(false);
        sourceImageRef.current = null;
        transformedCanvasRef.current = null;
        return undefined;
      }

      const sourceImage = sourceImageRef.current;
      if (!sourceImage) return undefined;

      if (transformRafRef.current) {
        cancelAnimationFrame(transformRafRef.current);
      }

      transformRafRef.current = requestAnimationFrame(() => {
        transformRafRef.current = 0;

        try {
          const baseW = sourceImage.naturalWidth || nw || 1;
          const baseH = sourceImage.naturalHeight || nh || 1;
          const rads = (previewRotate * Math.PI) / 180;
          const boxW =
            Math.abs(baseW * Math.cos(rads)) + Math.abs(baseH * Math.sin(rads));
          const boxH =
            Math.abs(baseW * Math.sin(rads)) + Math.abs(baseH * Math.cos(rads));
          const scale = Math.max(
            0.05,
            Math.min(1, MAX_TRANSFORM_PREVIEW_DIM / Math.max(1, boxW, boxH)),
          );

          const canvas = transformedCanvasRef.current || document.createElement('canvas');
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
            sourceImage,
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
      });

      return () => {
        if (transformRafRef.current) {
          cancelAnimationFrame(transformRafRef.current);
          transformRafRef.current = 0;
        }
      };
    }, [
      previewRotate,
      transforms.flip.horizontal,
      transforms.flip.vertical,
      nw,
      nh,
      sourceImageVersion,
      requiresCanvasPreview,
    ]);

    useEffect(() => {
      if (!requiresCanvasPreview) return undefined;

      let cancelled = false;
      setIsCanvasReady(false);
      sourceImageRef.current = null;
      transformedCanvasRef.current = null;

      const loadSourceImage = async () => {
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
          sourceImageRef.current = img;
          setSourceImageVersion((prev) => prev + 1);
        } catch {
          transformedCanvasRef.current = null;
          setIsCanvasReady(false);
        }
      };

      loadSourceImage();

      return () => {
        cancelled = true;
      };
    }, [image.objectUrl, requiresCanvasPreview]);

    useEffect(() => {
      if (!requiresCanvasPreview) return undefined;

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
    }, [drawPreview, requiresCanvasPreview]);

    useEffect(
      () => () => {
        if (drawRafRef.current) {
          cancelAnimationFrame(drawRafRef.current);
          drawRafRef.current = 0;
        }
        if (transformRafRef.current) {
          cancelAnimationFrame(transformRafRef.current);
          transformRafRef.current = 0;
        }
        sourceImageRef.current = null;
        transformedCanvasRef.current = null;
      },
      [],
    );

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
              style={{ borderRadius: previewCornerRadiusCss }}
            >
              <img
                src={image.objectUrl}
                alt={image.name}
                className={`preview-image preview-image--fallback ${
                  requiresCanvasPreview && isCanvasReady ? 'hidden' : ''
                }`}
              />
              {requiresCanvasPreview && (
                <canvas
                  ref={previewCanvasRef}
                  className={`preview-image preview-image--canvas ${
                    isCanvasReady ? 'visible' : ''
                  }`}
                  aria-label={image.name}
                />
              )}
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
