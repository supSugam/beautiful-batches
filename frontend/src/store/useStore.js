import { create } from 'zustand';
import {
  normalizeStoredCoordinates,
  toStoredCoordinates,
} from '../utils/cropCoordinates';

const yieldToMainThread = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const readDimensionsWithImageElement = (objectUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1,
        height: img.naturalHeight || 1,
      });
    img.onerror = reject;
    img.src = objectUrl;
  });

// Helper for loading natural dimensions progressively and cheaply.
async function loadImageWithDimensions(file, id, relativePath) {
  const objectUrl = URL.createObjectURL(file);
  let width = 1;
  let height = 1;

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width || 1;
      height = bitmap.height || 1;
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    } else {
      const result = await readDimensionsWithImageElement(objectUrl);
      width = result.width;
      height = result.height;
    }
  } catch {
    try {
      const result = await readDimensionsWithImageElement(objectUrl);
      width = result.width;
      height = result.height;
    } catch {
      width = 1;
      height = 1;
    }
  }

  return {
    id,
    name: file.name,
    relativePath,
    objectUrl,
    file,
    naturalWidth: width,
    naturalHeight: height,
    naturalRatio: width / height,
  };
}

const getDefaultInspectorWidth = () => {
  if (typeof window === 'undefined') return 980;
  const viewportWidth = Math.max(1, window.innerWidth || 1440);
  const preferred = viewportWidth * 0.66;
  const min = Math.max(360, viewportWidth * 0.32);
  const max = viewportWidth * 0.94;
  return Math.round(Math.max(min, Math.min(preferred, max)));
};

const GRID_RATIO_PRECISION = 200;
const quantizeGridRatio = (value) =>
  Math.round(Number(value || 0) * GRID_RATIO_PRECISION) / GRID_RATIO_PRECISION;

const getGridRatioSignature = (entry) => {
  const coordinates = normalizeStoredCoordinates(entry?.coordinates);
  const width = coordinates?.width;
  const height = coordinates?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) {
    return null;
  }

  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return quantizeGridRatio(ratio);
};

const getQuarterTurn = (entry) => {
  const rotate = Number(entry?.transforms?.rotate || 0);
  if (!Number.isFinite(rotate)) return 0;
  const normalized = ((rotate % 360) + 360) % 360;
  return Math.round(normalized / 90) % 4;
};

const hasGridLayoutAffectingChange = (previousEntry, nextEntry) => {
  const prevRatio = getGridRatioSignature(previousEntry);
  const nextRatio = getGridRatioSignature(nextEntry);
  if (prevRatio !== nextRatio) return true;

  // Fallback when no explicit crop size exists yet.
  if (!prevRatio && !nextRatio) {
    return getQuarterTurn(previousEntry) !== getQuarterTurn(nextEntry);
  }

  return false;
};

const DEFAULT_PADDING = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const DEFAULT_CORNER_RADIUS = Object.freeze({
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
});

const approxEqual = (a, b, tolerance = 0.51) =>
  Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;

const normalizeRotation = (value) => {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value % 360) + 360) % 360;
  return normalized > 359.999 ? 0 : normalized;
};

const getRotatedBounds = (width, height, rotation) => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const radians = (normalizeRotation(rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: safeWidth * cos + safeHeight * sin,
    height: safeWidth * sin + safeHeight * cos,
  };
};

const normalizePaddingValue = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

const normalizePadding = (padding) => ({
  top: normalizePaddingValue(Number(padding?.top ?? 0)),
  right: normalizePaddingValue(Number(padding?.right ?? 0)),
  bottom: normalizePaddingValue(Number(padding?.bottom ?? 0)),
  left: normalizePaddingValue(Number(padding?.left ?? 0)),
});

const normalizeCornerRadius = (radius) => ({
  topLeft: normalizePaddingValue(Number(radius?.topLeft ?? 0)),
  topRight: normalizePaddingValue(Number(radius?.topRight ?? 0)),
  bottomRight: normalizePaddingValue(Number(radius?.bottomRight ?? 0)),
  bottomLeft: normalizePaddingValue(Number(radius?.bottomLeft ?? 0)),
});

const hasAnyPadding = (padding) =>
  padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0;

const hasAnyCornerRadius = (radius) =>
  radius.topLeft > 0 ||
  radius.topRight > 0 ||
  radius.bottomRight > 0 ||
  radius.bottomLeft > 0;

const hasMeaningfulImageChange = (entry, image) => {
  if (!entry) return false;

  const rotate = normalizeRotation(Number(entry?.transforms?.rotate || 0));
  const flipHorizontal = Boolean(entry?.transforms?.flip?.horizontal);
  const flipVertical = Boolean(entry?.transforms?.flip?.vertical);
  if (rotate > 0.001 || flipHorizontal || flipVertical) return true;

  if (entry?.aspect !== null && entry?.aspect !== undefined) return true;

  const outputWidth = Number(entry?.outputWidth ?? 0);
  if (Number.isFinite(outputWidth) && outputWidth > 0) return true;

  const normalizedPadding = normalizePadding(entry?.padding || DEFAULT_PADDING);
  if (hasAnyPadding(normalizedPadding)) return true;

  const normalizedCornerRadius = normalizeCornerRadius(
    entry?.cornerRadius || DEFAULT_CORNER_RADIUS,
  );
  if (hasAnyCornerRadius(normalizedCornerRadius)) return true;

  const coords = normalizeStoredCoordinates(entry?.coordinates);
  if (!coords) return false;

  const baselineWidth = Math.max(
    1,
    Number(image?.naturalWidth || entry?.imageWidth || 1),
  );
  const baselineHeight = Math.max(
    1,
    Number(image?.naturalHeight || entry?.imageHeight || 1),
  );

  if (!approxEqual(coords.left, 0)) return true;
  if (!approxEqual(coords.top, 0)) return true;
  if (!approxEqual(coords.width, baselineWidth)) return true;
  if (!approxEqual(coords.height, baselineHeight)) return true;

  return false;
};

const normalizeCropEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    coordinates: toStoredCoordinates(entry.coordinates),
  };
};

const SESSION_MODIFIED_THROTTLE_MS = 750;
const getNowTs = () => Date.now();

const useStore = create((set, get) => ({
  // --- Global State ---
  images: [],
  cropData: new Map(),
  captionById: new Map(),
  sessionModifiedAt: new Map(),
  cropLayoutVersion: 0,
  selectedId: null,
  processing: null,

  // --- UI Settings ---
  rowHeight: 250,
  format: 'png',
  quality: 90,
  ifFileExists: 'append',
  showAllFooters: true,
  inspectorWidth: getDefaultInspectorWidth(),
  sortOption: 'last_modified',

  // --- Actions ---

  // Images
  setImages: (images) => set({ images }),

  addImages: async (rawImages) => {
    if (!Array.isArray(rawImages) || rawImages.length === 0) return;

    const CHUNK_SIZE = 20;
    for (let index = 0; index < rawImages.length; index += CHUNK_SIZE) {
      const chunk = rawImages.slice(index, index + CHUNK_SIZE);
      const withDims = await Promise.all(
        chunk.map((img) =>
          loadImageWithDimensions(img.file, img.id, img.relativePath),
        ),
      );
      set((state) => ({
        images: [
          ...state.images,
          ...withDims.map((image) => ({
            ...image,
            sourceLastModified: Number(image?.file?.lastModified || 0) || 0,
            sourceSize: Number(image?.file?.size || 0) || 0,
            loadedAt: getNowTs(),
          })),
        ],
      }));

      if (index + CHUNK_SIZE < rawImages.length) {
        await yieldToMainThread();
      }
    }
  },

  deleteImage: (id) => {
    const { images, cropData, captionById, selectedId, sessionModifiedAt } =
      get();
    const img = images.find((i) => i.id === id);
    if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);

    const newCropData = new Map(cropData);
    newCropData.delete(id);
    const nextCaptionById = new Map(captionById);
    nextCaptionById.delete(id);
    const nextSessionModifiedAt = new Map(sessionModifiedAt);
    nextSessionModifiedAt.delete(id);

    set({
      images: images.filter((i) => i.id !== id),
      cropData: newCropData,
      captionById: nextCaptionById,
      sessionModifiedAt: nextSessionModifiedAt,
      selectedId: selectedId === id ? null : selectedId,
    });
  },

  clearAll: () => {
    const { images } = get();
    images.forEach((img) => {
      if (img.objectUrl) URL.revokeObjectURL(img.objectUrl);
    });
    set({
      images: [],
      cropData: new Map(),
      captionById: new Map(),
      sessionModifiedAt: new Map(),
      selectedId: null,
    });
  },

  deleteFolder: (folderPath) => {
    const normalizedFolderPath = String(folderPath || '').replace(/\\/g, '/');
    if (!normalizedFolderPath) return;
    const folderPrefix = normalizedFolderPath.endsWith('/')
      ? normalizedFolderPath
      : `${normalizedFolderPath}/`;

    const { images, cropData, captionById, selectedId, sessionModifiedAt } =
      get();
    const toRemove = images.filter((img) =>
      String(img.relativePath || '')
        .replace(/\\/g, '/')
        .startsWith(folderPrefix),
    );
    if (toRemove.length === 0) return;

    const removeIds = new Set(toRemove.map((img) => img.id));
    toRemove.forEach((img) => {
      if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);
    });

    const nextCropData = new Map(cropData);
    removeIds.forEach((id) => nextCropData.delete(id));
    const nextCaptionById = new Map(captionById);
    removeIds.forEach((id) => nextCaptionById.delete(id));
    const nextSessionModifiedAt = new Map(sessionModifiedAt);
    removeIds.forEach((id) => nextSessionModifiedAt.delete(id));

    set({
      images: images.filter((img) => !removeIds.has(img.id)),
      cropData: nextCropData,
      captionById: nextCaptionById,
      sessionModifiedAt: nextSessionModifiedAt,
      selectedId: selectedId && removeIds.has(selectedId) ? null : selectedId,
    });
  },

  // Selection
  setSelectedId: (id) => set({ selectedId: id }),

  selectNext: () => {
    const { images, selectedId } = get();
    if (!selectedId) return;
    const idx = images.findIndex((img) => img.id === selectedId);
    if (idx < images.length - 1) set({ selectedId: images[idx + 1].id });
  },

  selectPrev: () => {
    const { images, selectedId } = get();
    if (!selectedId) return;
    const idx = images.findIndex((img) => img.id === selectedId);
    if (idx > 0) set({ selectedId: images[idx - 1].id });
  },

  // Crop Data
  setCropChange: (id, coords) => {
    set((state) => {
      // Mutate in place to avoid cloning a large Map every pointer frame.
      // Fine here because subscribers select by key (`cropData.get(id)`), not by map identity.
      const next = state.cropData;
      const previousEntry = next.get(id);
      const normalizedCoords = normalizeCropEntry(coords);
      next.set(id, normalizedCoords);
      const image = state.images.find((img) => img.id === id);
      const isMeaningfulChange = hasMeaningfulImageChange(normalizedCoords, image);
      const now = getNowTs();
      const previousModifiedAt = state.sessionModifiedAt.get(id) || 0;
      let nextSessionModifiedAt = state.sessionModifiedAt;
      if (isMeaningfulChange) {
        if (
          previousModifiedAt === 0 ||
          now - previousModifiedAt >= SESSION_MODIFIED_THROTTLE_MS
        ) {
          nextSessionModifiedAt = new Map(state.sessionModifiedAt);
          nextSessionModifiedAt.set(id, now);
        }
      } else if (previousModifiedAt > 0) {
        const caption = String(state.captionById.get(id) || '').trim();
        if (caption === '') {
          nextSessionModifiedAt = new Map(state.sessionModifiedAt);
          nextSessionModifiedAt.delete(id);
        }
      }
      const shouldBumpLayoutVersion = hasGridLayoutAffectingChange(
        previousEntry,
        normalizedCoords,
      );
      if (!shouldBumpLayoutVersion) {
        return {
          cropData: next,
          sessionModifiedAt: nextSessionModifiedAt,
        };
      }
      return {
        cropData: next,
        sessionModifiedAt: nextSessionModifiedAt,
        cropLayoutVersion: state.cropLayoutVersion + 1,
      };
    });
  },

  applyCropToImages: (sourceId, targetIds) => {
    const { images, cropData } = get();
    const sourceData = cropData.get(sourceId);
    if (!sourceData) return;
    const sourceCoordinates = normalizeStoredCoordinates(sourceData.coordinates);
    if (!sourceCoordinates) return;

    const sourceImg = images.find((img) => img.id === sourceId);
    if (!sourceImg) return;

    const transforms = sourceData.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };
    const { rotate } = transforms;
    const sourceBounds = getRotatedBounds(
      sourceImg.naturalWidth,
      sourceImg.naturalHeight,
      rotate,
    );
    const sourceW = sourceBounds.width;
    const sourceH = sourceBounds.height;

    const relLeft = sourceCoordinates.left / sourceW;
    const relTop = sourceCoordinates.top / sourceH;
    const relWidth = sourceCoordinates.width / sourceW;
    const relHeight = sourceCoordinates.height / sourceH;

    set((state) => {
      // Same in-place update strategy as setCropChange for bulk operations.
      const next = state.cropData;
      const nextSessionModifiedAt = new Map(state.sessionModifiedAt);
      const now = getNowTs();
      targetIds.forEach((id) => {
        const targetImg = images.find((img) => img.id === id);
        if (!targetImg) return;

        const targetBounds = getRotatedBounds(
          targetImg.naturalWidth,
          targetImg.naturalHeight,
          rotate,
        );
        const targetW = targetBounds.width;
        const targetH = targetBounds.height;

        next.set(id, {
          ...sourceData,
          coordinates: {
            left: Math.round(relLeft * targetW),
            top: Math.round(relTop * targetH),
            width: Math.round(relWidth * targetW),
            height: Math.round(relHeight * targetH),
          },
        });
        const nextEntry = next.get(id);
        if (hasMeaningfulImageChange(nextEntry, targetImg)) {
          nextSessionModifiedAt.set(id, now);
        } else {
          const caption = String(state.captionById.get(id) || '').trim();
          if (caption === '') {
            nextSessionModifiedAt.delete(id);
          } else if (!nextSessionModifiedAt.has(id)) {
            nextSessionModifiedAt.set(id, now);
          }
        }
      });
      return {
        cropData: next,
        sessionModifiedAt: nextSessionModifiedAt,
        cropLayoutVersion:
          targetIds.length > 0
            ? state.cropLayoutVersion + 1
            : state.cropLayoutVersion,
      };
    });
  },

  setCaptionForImage: (id, caption) => {
    set((state) => {
      const nextCaption = String(caption ?? '');
      const previousCaption = state.captionById.get(id) || '';
      if (previousCaption === nextCaption) {
        return {};
      }

      const nextCaptionById = new Map(state.captionById);
      if (nextCaption.trim() === '') {
        nextCaptionById.delete(id);
      } else {
        nextCaptionById.set(id, nextCaption);
      }

      const image = state.images.find((img) => img.id === id);
      const entry = state.cropData.get(id);
      const hasMeaningfulCrop = hasMeaningfulImageChange(entry, image);
      const hasMeaningfulCaption = nextCaption.trim() !== '';
      const shouldMarkModified = hasMeaningfulCrop || hasMeaningfulCaption;

      let nextSessionModifiedAt = state.sessionModifiedAt;
      const previousModifiedAt = state.sessionModifiedAt.get(id) || 0;
      const now = getNowTs();

      if (shouldMarkModified) {
        if (
          previousModifiedAt === 0 ||
          now - previousModifiedAt >= SESSION_MODIFIED_THROTTLE_MS
        ) {
          nextSessionModifiedAt = new Map(state.sessionModifiedAt);
          nextSessionModifiedAt.set(id, now);
        }
      } else if (previousModifiedAt > 0) {
        nextSessionModifiedAt = new Map(state.sessionModifiedAt);
        nextSessionModifiedAt.delete(id);
      }

      return {
        captionById: nextCaptionById,
        sessionModifiedAt: nextSessionModifiedAt,
      };
    });
  },

  applyPersistedImageDrafts: ({
    cropEntriesById,
    captionsById,
    modifiedAtById,
  }) => {
    set((state) => {
      const nextCropData = new Map(state.cropData);
      const nextCaptionById = new Map(state.captionById);
      const nextSessionModifiedAt = new Map(state.sessionModifiedAt);

      let shouldBumpLayoutVersion = false;
      const entries = cropEntriesById ? Object.entries(cropEntriesById) : [];

      entries.forEach(([id, value]) => {
        const previousEntry = nextCropData.get(id);
        const normalizedValue = normalizeCropEntry(value);
        nextCropData.set(id, normalizedValue);
        if (hasGridLayoutAffectingChange(previousEntry, normalizedValue)) {
          shouldBumpLayoutVersion = true;
        }
      });

      if (captionsById) {
        Object.entries(captionsById).forEach(([id, value]) => {
          const nextCaption = String(value ?? '');
          if (nextCaption.trim() === '') {
            nextCaptionById.delete(id);
          } else {
            nextCaptionById.set(id, nextCaption);
          }
        });
      }

      if (modifiedAtById) {
        Object.entries(modifiedAtById).forEach(([id, value]) => {
          const ts = Number(value || 0) || getNowTs();
          nextSessionModifiedAt.set(id, ts);
        });
      }

      return {
        cropData: nextCropData,
        captionById: nextCaptionById,
        sessionModifiedAt: nextSessionModifiedAt,
        cropLayoutVersion: shouldBumpLayoutVersion
          ? state.cropLayoutVersion + 1
          : state.cropLayoutVersion,
      };
    });
  },

  // UI Settings
  setRowHeight: (rowHeight) => set({ rowHeight }),
  setFormat: (format) => set({ format }),
  setQuality: (quality) => set({ quality }),
  setIfFileExists: (ifFileExists) =>
    set({
      ifFileExists:
        ifFileExists === 'skip' ||
        ifFileExists === 'overwrite' ||
        ifFileExists === 'append'
          ? ifFileExists
          : 'append',
    }),
  setShowAllFooters: (showAllFooters) => set({ showAllFooters }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  setSortOption: (sortOption) =>
    set({
      sortOption:
        sortOption === 'last_modified' ||
        sortOption === 'last_modified_oldest' ||
        sortOption === 'name_asc' ||
        sortOption === 'name_desc' ||
        sortOption === 'size_desc' ||
        sortOption === 'size_asc'
          ? sortOption
          : 'last_modified',
    }),
  setProcessing: (processing) => set({ processing }),
}));

export default useStore;
