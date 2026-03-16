import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  animate,
} from 'framer-motion';
import type { PaddingFillType } from '../../../types/app';
import {
  clampCornerRadiusToReference,
  clampPaddingToReference,
} from '../../../utils/boxValues';
import { computePaddedContentRect } from '../../../utils/paddedContentRect';

/**
 * EditorCanvas — renders the image with rotation, flip, and zoom
 * using CSS transforms on an <img> element for smooth framer-motion animations.
 *
 * The image is fit-to-container using object-fit logic, then transforms are
 * applied via CSS (which also enables GPU-accelerated transitions).
 */
const SPRING_CONFIG = { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 } as const;
const ZOOM_SPRING = { type: 'spring', stiffness: 500, damping: 35, mass: 0.3 } as const;
const ANCHOR_SPRING = {
  type: 'spring',
  stiffness: 400,
  damping: 40,
  mass: 0.2,
} as const;

type EditorCanvasFitLayout = {
  scale: number;
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
};

type EditorCanvasProps = {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  zoom?: number;
  zoomAnchor?: { x: number; y: number };
  fitLayout: EditorCanvasFitLayout | null;
  containerWidth: number;
  containerHeight: number;
  paddingPx?: number;
  cornerRadius?: unknown;
  paddingFillType?: PaddingFillType;
  paddingFillValue?: string;
  paddingImageUrl?: string | null;
};

type EditorCanvasRef = {
  repaint: () => void;
};

const EditorCanvas = forwardRef<EditorCanvasRef, EditorCanvasProps>(function EditorCanvas(
  {
    imageUrl,
    naturalWidth,
    naturalHeight,
    rotation = 0,
    flipH = false,
    flipV = false,
    zoom = 1,
    zoomAnchor = { x: 0.5, y: 0.5 },
    fitLayout,
    containerWidth,
    containerHeight,
    paddingPx = 0,
    cornerRadius,
    paddingFillType = 'empty',
    paddingFillValue = '',
    paddingImageUrl = null,
  },
  ref,
) {
  const animatedRotation = useMotionValue(rotation);
  const animatedScaleX = useMotionValue(flipH ? -1 : 1);
  const animatedScaleY = useMotionValue(flipV ? -1 : 1);
  const animatedZoom = useMotionValue(zoom);
  const animatedAnchorX = useMotionValue(zoomAnchor.x * 100);
  const animatedAnchorY = useMotionValue(zoomAnchor.y * 100);

  // Animate rotation changes
  useEffect(() => {
    const currentValue = animatedRotation.get();
    let target = rotation;
    while (target - currentValue > 180) target -= 360;
    while (target - currentValue < -180) target += 360;

    animate(animatedRotation, target, {
      type: 'spring',
      stiffness: 280,
      damping: 28,
      mass: 0.7,
    });
  }, [rotation, animatedRotation]);

  // Animate flip changes
  useEffect(() => {
    animate(animatedScaleX, flipH ? -1 : 1, SPRING_CONFIG);
  }, [flipH]);

  useEffect(() => {
    animate(animatedScaleY, flipV ? -1 : 1, SPRING_CONFIG);
  }, [flipV]);

  // Animate zoom changes
  useEffect(() => {
    animate(animatedZoom, zoom, ZOOM_SPRING);
  }, [zoom, animatedZoom]);

  // Animate anchor changes
  useEffect(() => {
    animate(animatedAnchorX, zoomAnchor.x * 100, ANCHOR_SPRING);
    animate(animatedAnchorY, zoomAnchor.y * 100, ANCHOR_SPRING);
  }, [zoomAnchor.x, zoomAnchor.y, animatedAnchorX, animatedAnchorY]);

  const animatedOrigin = useMotionTemplate`${animatedAnchorX}% ${animatedAnchorY}%`;

  useImperativeHandle(ref, () => ({
    repaint: () => {}, // No-op — CSS handles rendering
  }));

  if (
    !fitLayout ||
    fitLayout.displayW <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return null;
  }

  const { scale, offsetX, offsetY, displayW, displayH } = fitLayout;

  // The image is positioned at the center of the display area.
  // For a rotated image (e.g., 90°): the effective dimensions are swapped,
  // but the <img> needs to show the ORIGINAL image, then CSS-rotate it.
  //
  // fitLayout is computed from effective dimensions, so displayW/displayH
  // already reflect the rotated bounding box. We render the img at original
  // aspect, sized so that after rotation, it fills exactly displayW × displayH.

  // Draw image in natural aspect at fit scale, then rotate around center.
  const imgW = naturalWidth * scale;
  const imgH = naturalHeight * scale;

  const outerWidth = Math.max(1, displayW / Math.max(0.0001, scale));
  const outerHeight = Math.max(1, displayH / Math.max(0.0001, scale));
  const paddingValues = clampPaddingToReference(
    String(Math.max(0, Math.round(Number(paddingPx) || 0))),
    outerWidth,
    outerHeight,
  );
  const contentRect = computePaddedContentRect(
    outerWidth,
    outerHeight,
    paddingValues,
  );

  const contentLeft = contentRect.x * scale;
  const contentTop = contentRect.y * scale;
  const contentW = contentRect.width * scale;
  const contentH = contentRect.height * scale;

  const clampedCornerRadius = clampCornerRadiusToReference(
    cornerRadius as any,
    contentRect.width,
    contentRect.height,
  );
  const cornerRadiusCss = `${Math.max(0, clampedCornerRadius.topLeft) * scale}px ${
    Math.max(0, clampedCornerRadius.topRight) * scale
  }px ${Math.max(0, clampedCornerRadius.bottomRight) * scale}px ${
    Math.max(0, clampedCornerRadius.bottomLeft) * scale
  }px`;

  const effectiveFillType: PaddingFillType =
    paddingFillType === 'image' && !String(paddingImageUrl || '').trim()
      ? 'empty'
      : paddingFillType;
  const effectiveFillValue =
    typeof paddingFillValue === 'string' && paddingFillValue.trim()
      ? paddingFillValue.trim()
      : '#ffffff';

  const fillStyle: React.CSSProperties = (() => {
    if (effectiveFillType === 'color') {
      return { background: effectiveFillValue };
    }
    if (effectiveFillType === 'image' && paddingImageUrl) {
      return {
        backgroundImage: `url(${paddingImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    return { background: 'transparent' };
  })();

  return (
    <motion.div
      className="editor-canvas-stage transparency-grid"
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        width: displayW,
        height: displayH,
        pointerEvents: 'none',
        scale: animatedZoom,
        transformOrigin: animatedOrigin,
        willChange: 'transform',
      }}
    >
      <div
        className="editor-canvas-fill"
        style={{
          position: 'absolute',
          inset: 0,
          ...fillStyle,
        }}
      />

      <div
        className="editor-canvas-content-clip"
        style={{
          position: 'absolute',
          left: contentLeft,
          top: contentTop,
          width: contentW,
          height: contentH,
          borderRadius: cornerRadiusCss,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div
          className="editor-canvas-content-stage"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: displayW,
            height: displayH,
            transform: `translate(-50%, -50%) scale(${contentRect.scale})`,
            transformOrigin: 'center',
            willChange: 'transform',
          }}
        >
          <motion.img
            src={imageUrl}
            className="editor-canvas-img"
            draggable={false}
            style={{
              position: 'absolute',
              left: displayW / 2 - imgW / 2,
              top: displayH / 2 - imgH / 2,
              width: imgW,
              height: imgH,
              pointerEvents: 'none',
              objectFit: 'fill',
              rotateZ: animatedRotation,
              scaleX: animatedScaleX,
              scaleY: animatedScaleY,
              willChange: 'transform',
            }}
            alt=""
          />
        </div>
      </div>
    </motion.div>
  );
});

export default React.memo(EditorCanvas);
