import type { FlipState } from '../../../types/app';

const MAX_PREVIEW_DIM = 2000;

/**
 * Generates a rotated and flipped version of the image source
 * Optimized with scaling for faster performance
 */
export async function generateVisualSource(
  imageUrl: string,
  rotation: number,
  flip: FlipState,
): Promise<Blob | null> {
  const img = new Image();
  img.src = imageUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load source image'));
  });

  const isRotated90 = rotation % 180 === 90;

  // Calculate scaled dimensions for preview
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  let targetW = isRotated90 ? origH : origW;
  let targetH = isRotated90 ? origW : origH;

  let scale = 1;
  if (targetW > MAX_PREVIEW_DIM || targetH > MAX_PREVIEW_DIM) {
    scale = Math.min(MAX_PREVIEW_DIM / targetW, MAX_PREVIEW_DIM / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  canvas.width = targetW;
  canvas.height = targetH;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);

  const drawW = origW * scale;
  const drawH = origH * scale;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Use slightly lower quality for faster encoding
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.8),
  );
}
