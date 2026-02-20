import type {
  EditorCropCoordinates,
  StoredCoordinates,
} from '../types/app';

type CoordinateRecord = Record<string, unknown>;

const asCoordinateRecord = (
  coordinates: unknown,
): CoordinateRecord | null => {
  if (!coordinates || typeof coordinates !== 'object') return null;
  return coordinates as CoordinateRecord;
};

const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const pickCoordinate = (
  coordinates: CoordinateRecord | null,
  legacyKey: keyof StoredCoordinates,
  modernKey: keyof EditorCropCoordinates,
  fallback = 0,
): number => {
  if (!coordinates) return fallback;

  const legacyValue = coordinates[legacyKey] as unknown;
  if (Number.isFinite(Number(legacyValue))) {
    return Number(legacyValue);
  }

  const modernValue = coordinates[modernKey] as unknown;
  if (Number.isFinite(Number(modernValue))) {
    return Number(modernValue);
  }

  return fallback;
};

export const normalizeStoredCoordinates = (
  coordinates: unknown,
): StoredCoordinates | null => {
  const record = asCoordinateRecord(coordinates);
  if (!record) return null;

  const width = pickCoordinate(record, 'width', 'w');
  const height = pickCoordinate(record, 'height', 'h');

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  return {
    left: Math.max(0, pickCoordinate(record, 'left', 'x')),
    top: Math.max(0, pickCoordinate(record, 'top', 'y')),
    width: safeWidth,
    height: safeHeight,
  };
};

export const toEditorCropCoordinates = (
  coordinates: unknown,
  fallbackWidth = 1,
  fallbackHeight = 1,
): EditorCropCoordinates => {
  const normalized = normalizeStoredCoordinates(coordinates);
  if (normalized) {
    return {
      x: normalized.left,
      y: normalized.top,
      w: normalized.width,
      h: normalized.height,
    };
  }

  return {
    x: 0,
    y: 0,
    w: Math.max(1, asFiniteNumber(fallbackWidth, 1)),
    h: Math.max(1, asFiniteNumber(fallbackHeight, 1)),
  };
};

export const toStoredCoordinates = (
  coordinates: unknown,
): StoredCoordinates | null => {
  const record = asCoordinateRecord(coordinates);
  if (!record) return null;

  const left = pickCoordinate(record, 'left', 'x');
  const top = pickCoordinate(record, 'top', 'y');
  const width = pickCoordinate(record, 'width', 'w');
  const height = pickCoordinate(record, 'height', 'h');

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  return {
    left: Math.max(0, asFiniteNumber(left)),
    top: Math.max(0, asFiniteNumber(top)),
    width: safeWidth,
    height: safeHeight,
  };
};
