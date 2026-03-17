import type { PaddingValues } from '../types/app';

export type PaddedContentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Uniform scale applied to the original content to fit inside padding constraints. */
  scale: number;
};

const clampNonNegativeInt = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
};

/**
 * Given an "outer canvas" size and padding constraints, compute the content rect
 * where the original image should be rendered to preserve aspect ratio.
 *
 * This intentionally uses integer math/rounding so UI previews can match backend export.
 */
export const computePaddedContentRect = (
  outerWidth: number,
  outerHeight: number,
  padding: Partial<PaddingValues> | null | undefined,
): PaddedContentRect => {
  const w = Math.max(1, Math.round(Number(outerWidth) || 1));
  const h = Math.max(1, Math.round(Number(outerHeight) || 1));

  const top = clampNonNegativeInt(padding?.top);
  const right = clampNonNegativeInt(padding?.right);
  const bottom = clampNonNegativeInt(padding?.bottom);
  const left = clampNonNegativeInt(padding?.left);

  const availableWidth = Math.max(1, w - left - right);
  const availableHeight = Math.max(1, h - top - bottom);

  /**
   * For "strict even padding", we ensure the visible content area is exactly the
   * "available area" (canvas minus padding). We use "cover" semantics so the
   * content is scaled to fill this area completely, then centered/cropped.
   * This guarantees that the padding distance measured from the canvas edge is 
   * exactly the requested pixel value on all sides.
   */
  const scale = Math.max(availableWidth / w, availableHeight / h);

  return {
    x: left,
    y: top,
    width: availableWidth,
    height: availableHeight,
    scale,
  };
};

