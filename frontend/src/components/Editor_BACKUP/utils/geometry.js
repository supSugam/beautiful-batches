
/**
 * Converts degrees to radians
 */
export const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Rotates a point (x, y) around an origin (ox, oy) by angle degrees
 */
export const rotatePoint = (x, y, ox, oy, angleDeg) => {
  const rad = toRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - ox;
  const dy = y - oy;
  return {
    x: ox + dx * cos - dy * sin,
    y: oy + dx * sin + dy * cos,
  };
};

/**
 * Calculates the bounding box of a rotated rectangle
 * width/height: dimensions of the rectangle
 * angleDeg: rotation in degrees
 */
export const getRotatedBoundingBox = (width, height, angleDeg) => {
  const rad = toRad(angleDeg);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
};

/**
 * Calculates the scale needed to fit a content rectangle (cw, ch) inside a container (tw, th)
 * taking rotation into account.
 * contentWidth/Height: unrotated dimensions
 * rotation: rotation in degrees
 */
export const getFitScale = (containerWidth, containerHeight, contentWidth, contentHeight, rotation) => {
  const bbox = getRotatedBoundingBox(contentWidth, contentHeight, rotation);
  if (bbox.width === 0 || bbox.height === 0) return 1;
  
  const scaleX = containerWidth / bbox.width;
  const scaleY = containerHeight / bbox.height;
  return Math.min(scaleX, scaleY);
};

/**
 * Constrains dimensions to an aspect ratio
 */
export const constrainToAspect = (width, height, aspect, grow = true) => {
  if (!aspect) return { width, height };
  
  const currentAspect = width / height;
  if (currentAspect < aspect) {
    // Too tall, need to be wider (or shorter)
    return grow ? { width: height * aspect, height } : { width, height: width / aspect };
  } else {
    // Too wide, need to be taller (or narrower)
    return grow ? { width, height: width / aspect } : { width: height * aspect, height };
  }
};

/**
 * Transforms a point from image coordinates to screen coordinates
 */
export const imageToScreen = (point, state, containerSize) => {
  const { x, y } = point;
  const { naturalWidth, naturalHeight, rot, flipH, flipV, zoom, pan, fitScale } = state;
  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;

  // 1. Center image (relative to center)
  let tx = x - naturalWidth / 2;
  let ty = y - naturalHeight / 2;

  // 2. Flip
  if (flipH) tx = -tx;
  if (flipV) ty = -ty;

  // 3. Rotate
  const rad = toRad(rot);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = tx * cos - ty * sin;
  const ry = tx * sin + ty * cos;

  // 4. Scale (fit + zoom)
  const scale = fitScale * zoom;
  const sx = rx * scale;
  const sy = ry * scale;

  // 5. Pan (relative to center)
  const px = sx + pan.x;
  const py = sy + pan.y;

  // 6. Translate to screen center
  return {
    x: px + cx,
    y: py + cy
  };
};

/**
 * Transforms a point from screen coordinates to image coordinates
 */
export const screenToImage = (point, state, containerSize) => {
  const { x, y } = point;
  const { naturalWidth, naturalHeight, rot, flipH, flipV, zoom, pan, fitScale } = state;
  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;

  // Inverse 6. Translate from screen center
  let px = x - cx;
  let py = y - cy;

  // Inverse 5. Pan
  px -= pan.x;
  py -= pan.y;

  // Inverse 4. Scale
  const scale = fitScale * zoom;
  if (scale === 0) return { x: 0, y: 0 };
  const rx = px / scale;
  const ry = py / scale;

  // Inverse 3. Rotate (rotate by -rot)
  const rad = toRad(-rot);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let tx = rx * cos - ry * sin;
  let ty = rx * sin + ry * cos;

  // Inverse 2. Flip
  if (flipH) tx = -tx;
  if (flipV) ty = -ty;

  // Inverse 1. Un-center
  return {
    x: tx + naturalWidth / 2,
    y: ty + naturalHeight / 2
  };
};

/**
 * Transforms crop coordinates (in rotated/flipped image space) to screen coordinates
 */
export const cropToScreen = (crop, state, containerSize) => {
  const { x, y, width, height } = crop;
  const { naturalWidth, naturalHeight, rot, zoom, pan, fitScale } = state;
  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;

  // 1. Calculate bounding box of transformed image
  // Note: Flip doesn't change bounding box size
  const bbox = getRotatedBoundingBox(naturalWidth, naturalHeight, rot);
  
  // 2. Center crop relative to bounding box center
  const tx = x - bbox.width / 2;
  const ty = y - bbox.height / 2;
  
  // 3. Scale (fit + zoom)
  const scale = fitScale * zoom;
  const sx = tx * scale;
  const sy = ty * scale;
  const sw = width * scale;
  const sh = height * scale;
  
  // 4. Pan
  const px = sx + pan.x;
  const py = sy + pan.y;
  
  // 5. Translate to screen center
  return {
    x: px + cx,
    y: py + cy,
    width: sw,
    height: sh
  };
};

/**
 * Transforms screen coordinates to crop coordinates
 */
export const screenToCrop = (rect, state, containerSize) => {
  const { x, y, width, height } = rect;
  const { naturalWidth, naturalHeight, rot, zoom, pan, fitScale } = state;
  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;

  // Inverse 5. Translate from center
  let px = x - cx;
  let py = y - cy;
  
  // Inverse 4. Pan
  px -= pan.x;
  py -= pan.y;
  
  // Inverse 3. Scale
  const scale = fitScale * zoom;
  if (scale === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const tx = px / scale;
  const ty = py / scale;
  const tw = width / scale;
  const th = height / scale;
  
  // Inverse 2. Un-center (relative to bbox center)
  const bbox = getRotatedBoundingBox(naturalWidth, naturalHeight, rot);
  
  return {
    x: tx + bbox.width / 2,
    y: ty + bbox.height / 2,
    width: tw,
    height: th
  };
};
