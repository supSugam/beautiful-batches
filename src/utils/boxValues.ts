import type { CornerRadiusValues, PaddingValues } from '../types/app';

export const MAX_PADDING_PX = 640;
export const MAX_CORNER_RADIUS_PX = 360;
export const INNER_PADDING_SIDE_RATIO = 0.4;

const BOX_NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

const clampRounded = (value: unknown, max = Number.POSITIVE_INFINITY): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(max, Math.round(numeric)));
};

const expandQuadShorthand = (
  values: number[],
): [number, number, number, number] | null => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const [a = 0, b = a, c = a, d = b] = values;

  if (values.length === 1) return [a, a, a, a];
  if (values.length === 2) return [a, b, a, b];
  if (values.length === 3) return [a, b, c, b];
  return [a, b, c, d];
};

const parseQuadFromString = (value: string): [number, number, number, number] | null => {
  const matches = String(value || '').match(BOX_NUMBER_PATTERN);
  if (!matches || matches.length === 0) return null;
  const numeric = matches
    .slice(0, 4)
    .map((token) => Number.parseFloat(token))
    .filter((token) => Number.isFinite(token));
  if (numeric.length === 0) return null;
  return expandQuadShorthand(numeric);
};

export const normalizePaddingInput = (
  padding: Partial<PaddingValues> | string | null | undefined,
  maxPaddingPx = MAX_PADDING_PX,
): PaddingValues => {
  if (padding && typeof padding === 'object') {
    return {
      top: clampRounded(padding.top, maxPaddingPx),
      right: clampRounded(padding.right, maxPaddingPx),
      bottom: clampRounded(padding.bottom, maxPaddingPx),
      left: clampRounded(padding.left, maxPaddingPx),
    };
  }

  if (typeof padding === 'string') {
    const quad = parseQuadFromString(padding);
    if (quad) {
      return {
        top: clampRounded(quad[0], maxPaddingPx),
        right: clampRounded(quad[1], maxPaddingPx),
        bottom: clampRounded(quad[2], maxPaddingPx),
        left: clampRounded(quad[3], maxPaddingPx),
      };
    }
  }

  return { top: 0, right: 0, bottom: 0, left: 0 };
};

export const clampPaddingToReference = (
  padding: Partial<PaddingValues> | string | null | undefined,
  referenceWidth: number,
  referenceHeight: number,
  {
    sideRatio = INNER_PADDING_SIDE_RATIO,
    maxPaddingPx = MAX_PADDING_PX,
  }: { sideRatio?: number; maxPaddingPx?: number } = {},
): PaddingValues => {
  const normalized = normalizePaddingInput(padding, maxPaddingPx);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const horizontalCap = Math.max(
    0,
    Math.min(maxPaddingPx, Math.round(safeWidth * sideRatio)),
  );
  const verticalCap = Math.max(
    0,
    Math.min(maxPaddingPx, Math.round(safeHeight * sideRatio)),
  );

  return {
    top: Math.min(normalized.top, verticalCap),
    right: Math.min(normalized.right, horizontalCap),
    bottom: Math.min(normalized.bottom, verticalCap),
    left: Math.min(normalized.left, horizontalCap),
  };
};

export const getEvenPaddingCap = (
  referenceWidth: number,
  referenceHeight: number,
  {
    sideRatio = INNER_PADDING_SIDE_RATIO,
    maxPaddingPx = MAX_PADDING_PX,
  }: { sideRatio?: number; maxPaddingPx?: number } = {},
): number => {
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const horizontalCap = Math.max(
    0,
    Math.min(maxPaddingPx, Math.round(safeWidth * sideRatio)),
  );
  const verticalCap = Math.max(
    0,
    Math.min(maxPaddingPx, Math.round(safeHeight * sideRatio)),
  );
  return Math.min(horizontalCap, verticalCap);
};

export const normalizeCornerRadiusInput = (
  radius: Partial<CornerRadiusValues> | string | null | undefined,
  maxCornerRadiusPx = MAX_CORNER_RADIUS_PX,
): CornerRadiusValues => {
  if (radius && typeof radius === 'object') {
    return {
      topLeft: clampRounded(radius.topLeft, maxCornerRadiusPx),
      topRight: clampRounded(radius.topRight, maxCornerRadiusPx),
      bottomRight: clampRounded(radius.bottomRight, maxCornerRadiusPx),
      bottomLeft: clampRounded(radius.bottomLeft, maxCornerRadiusPx),
    };
  }

  if (typeof radius === 'string') {
    const quad = parseQuadFromString(radius);
    if (quad) {
      return {
        topLeft: clampRounded(quad[0], maxCornerRadiusPx),
        topRight: clampRounded(quad[1], maxCornerRadiusPx),
        bottomRight: clampRounded(quad[2], maxCornerRadiusPx),
        bottomLeft: clampRounded(quad[3], maxCornerRadiusPx),
      };
    }
  }

  return {
    topLeft: 0,
    topRight: 0,
    bottomRight: 0,
    bottomLeft: 0,
  };
};

export const clampCornerRadiusToReference = (
  radius: Partial<CornerRadiusValues> | string | null | undefined,
  referenceWidth: number,
  referenceHeight: number,
  maxCornerRadiusPx = MAX_CORNER_RADIUS_PX,
): CornerRadiusValues => {
  const normalized = normalizeCornerRadiusInput(radius, maxCornerRadiusPx);
  const safeWidth = Math.max(1, Number(referenceWidth) || 1);
  const safeHeight = Math.max(1, Number(referenceHeight) || 1);
  const maxRadius = Math.max(
    0,
    Math.min(
      maxCornerRadiusPx,
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
