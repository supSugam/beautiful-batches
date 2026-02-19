import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  animate,
} from 'framer-motion';

/**
 * EditorCanvas — renders the image with rotation, flip, and zoom
 * using CSS transforms on an <img> element for smooth framer-motion animations.
 *
 * The image is fit-to-container using object-fit logic, then transforms are
 * applied via CSS (which also enables GPU-accelerated transitions).
 */
const SPRING_CONFIG = { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 };
const ZOOM_SPRING = { type: 'spring', stiffness: 500, damping: 35, mass: 0.3 };
const ANCHOR_SPRING = {
  type: 'spring',
  stiffness: 400,
  damping: 40,
  mass: 0.2,
};

const EditorCanvas = forwardRef(function EditorCanvas(
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

  return (
    <motion.div
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
    </motion.div>
  );
});

export default React.memo(EditorCanvas);

