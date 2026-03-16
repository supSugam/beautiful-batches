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

  const scale = Math.min(1, availableWidth / w, availableHeight / h);
  const contentWidth = Math.max(1, Math.round(w * scale));
  const contentHeight = Math.max(1, Math.round(h * scale));

  const leftoverWidth = Math.max(0, availableWidth - contentWidth);
  const leftoverHeight = Math.max(0, availableHeight - contentHeight);

  const x = left + Math.floor(leftoverWidth / 2);
  const y = top + Math.floor(leftoverHeight / 2);

  return {
    x,
    y,
    width: contentWidth,
    height: contentHeight,
    scale,
  };
};

