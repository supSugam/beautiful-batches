const asFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const pickCoordinate = (coordinates, legacyKey, modernKey, fallback = 0) => {
  if (!coordinates || typeof coordinates !== 'object') return fallback;

  const legacyValue = coordinates[legacyKey];
  if (Number.isFinite(Number(legacyValue))) {
    return Number(legacyValue);
  }

  const modernValue = coordinates[modernKey];
  if (Number.isFinite(Number(modernValue))) {
    return Number(modernValue);
  }

  return fallback;
};

export const normalizeStoredCoordinates = (coordinates) => {
  if (!coordinates || typeof coordinates !== 'object') return null;

  const width = pickCoordinate(coordinates, 'width', 'w');
  const height = pickCoordinate(coordinates, 'height', 'h');

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  return {
    left: Math.max(0, pickCoordinate(coordinates, 'left', 'x')),
    top: Math.max(0, pickCoordinate(coordinates, 'top', 'y')),
    width: safeWidth,
    height: safeHeight,
  };
};

export const toEditorCropCoordinates = (
  coordinates,
  fallbackWidth = 1,
  fallbackHeight = 1,
) => {
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

export const toStoredCoordinates = (coordinates) => {
  if (!coordinates || typeof coordinates !== 'object') return null;

  const left = pickCoordinate(coordinates, 'left', 'x');
  const top = pickCoordinate(coordinates, 'top', 'y');
  const width = pickCoordinate(coordinates, 'width', 'w');
  const height = pickCoordinate(coordinates, 'height', 'h');

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
