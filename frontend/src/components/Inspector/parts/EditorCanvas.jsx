import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

/**
 * EditorCanvas — renders the image with rotation, flip, and zoom
 * using CSS transforms on an <img> element for smooth framer-motion animations.
 *
 * The image is fit-to-container using object-fit logic, then transforms are
 * applied via CSS (which also enables GPU-accelerated transitions).
 */
const SPRING_CONFIG = { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 };

const EditorCanvas = forwardRef(function EditorCanvas(
  {
    imageUrl,
    naturalWidth,
    naturalHeight,
    rotation = 0,
    flipH = false,
    flipV = false,
    zoom = 1,
    fitLayout,
    containerWidth,
    containerHeight,
  },
  ref,
) {
  const animatedRotation = useMotionValue(rotation);
  const animatedScaleX = useMotionValue(flipH ? -1 : 1);
  const animatedScaleY = useMotionValue(flipV ? -1 : 1);

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

  useImperativeHandle(ref, () => ({
    repaint: () => {}, // No-op — CSS handles rendering
  }));

  if (!fitLayout || fitLayout.displayW <= 0 || containerWidth <= 0 || containerHeight <= 0) {
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

  // Center of the image area
  const centerX = offsetX + displayW / 2;
  const centerY = offsetY + displayH / 2;

  return (
    <motion.img
      src={imageUrl}
      className="editor-canvas-img"
      draggable={false}
      style={{
        position: 'absolute',
        left: centerX - imgW / 2,
        top: centerY - imgH / 2,
        width: imgW,
        height: imgH,
        pointerEvents: 'none',
        objectFit: 'fill',
        rotateZ: animatedRotation,
        scaleX: animatedScaleX,
        scaleY: animatedScaleY,
        scale: zoom,
        willChange: 'transform',
      }}
      alt=""
    />
  );
});

export default React.memo(EditorCanvas);
