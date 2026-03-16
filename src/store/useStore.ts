import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import {
  normalizeStoredCoordinates,
  toStoredCoordinates,
} from '../utils/cropCoordinates';
import { normalizeCornerRadiusInput, normalizePaddingInput } from '../utils/boxValues';
import type {
  CornerRadiusValues,
  CropEntry,
  EditorViewState,
  ExportFormat,
  FolderNode,
  GalleryImage,
  PaddingValues,
  RawUploadImage,
  SortOption,
  StoredCoordinates,
} from '../types/app';

const yieldToMainThread = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const readDimensionsWithImageElement = (objectUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1,
        height: img.naturalHeight || 1,
      });
    img.onerror = reject;
    img.src = objectUrl;
  });

const METADATA_HYDRATION_CONCURRENCY = 8;
const METADATA_HYDRATION_BATCH_SIZE = 48;

const revokeImageObjectUrl = (
  image: Pick<GalleryImage, 'objectUrl' | 'assetUrl'> | null | undefined,
) => {
  if (!image?.objectUrl || image.assetUrl) return;
  try {
    URL.revokeObjectURL(image.objectUrl);
  } catch {
    // Ignore invalid blob URL revocations.
  }
};

const toGalleryImageShell = (raw: RawUploadImage): GalleryImage => {
  const objectUrl = raw.assetUrl || URL.createObjectURL(raw.file);
  const nativeWidth = Math.max(0, Number(raw.nativeWidth || 0) || 0);
  const nativeHeight = Math.max(0, Number(raw.nativeHeight || 0) || 0);
  const hasNativeDimensions = nativeWidth > 0 && nativeHeight > 0;
  const naturalWidth = hasNativeDimensions ? nativeWidth : 1;
  const naturalHeight = hasNativeDimensions ? nativeHeight : 1;
  const naturalRatio = naturalWidth / Math.max(1, naturalHeight);
  const sourceLastModified =
    Number(raw.nativeLastModifiedAt || raw?.file?.lastModified || 0) || 0;
  const sourceAccessedAt =
    Number(raw.nativeAccessedAt || sourceLastModified || 0) || 0;
  const sourceCreatedAt =
    Number(raw.nativeCreatedAt || sourceLastModified || 0) || 0;

  return {
    ...raw,
    id: raw.id,
    name: raw.file.name,
    relativePath: raw.relativePath,
    objectUrl,
    naturalWidth,
    naturalHeight,
    naturalRatio: Number.isFinite(naturalRatio) && naturalRatio > 0 ? naturalRatio : 1,
    dimensionsLoaded: hasNativeDimensions,
    sourceAccessedAt,
    sourceCreatedAt,
    sourceLastModified,
    sourceSize: raw.nativeSize ?? (Number(raw?.file?.size || 0) || 0),
    loadedAt: getNowTs(),
  };
};

const loadNaturalDimensions = async (
  image: Pick<GalleryImage, 'objectUrl' | 'assetUrl' | 'file'>,
): Promise<{ width: number; height: number }> => {
  if (image.assetUrl) {
    return readDimensionsWithImageElement(image.objectUrl);
  }

  if (
    typeof createImageBitmap === 'function' &&
    Number(image?.file?.size || 0) > 0
  ) {
    try {
      const bitmap = await createImageBitmap(image.file);
      const width = bitmap.width || 1;
      const height = bitmap.height || 1;
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
      return { width, height };
    } catch {
      // Fall back to <img> decoding path.
    }
  }

  return readDimensionsWithImageElement(image.objectUrl);
};

const getDefaultInspectorWidth = () => {
  if (typeof window === 'undefined') return 980;
  const viewportWidth = Math.max(1, window.innerWidth || 1440);
  const preferred = viewportWidth * 0.66;
  const min = Math.max(360, viewportWidth * 0.32);
  const max = viewportWidth * 0.94;
  return Math.round(Math.max(min, Math.min(preferred, max)));
};

const getDefaultExplorerWidth = () => {
  return 260; // Initial default matching legacy CSS
};

const GRID_RATIO_PRECISION = 200;
const quantizeGridRatio = (value: number) =>
  Math.round(Number(value || 0) * GRID_RATIO_PRECISION) / GRID_RATIO_PRECISION;

const getGridRatioSignature = (
  entry: CropEntry | undefined,
  image?: GalleryImage,
): number | null => {
  const coordinates = normalizeStoredCoordinates(entry?.coordinates);
  const coordinatesWidth = Number(coordinates?.width || 0);
  const coordinatesHeight = Number(coordinates?.height || 0);

  let width = 0;
  let height = 0;
  if (
    Number.isFinite(coordinatesWidth) &&
    Number.isFinite(coordinatesHeight) &&
    coordinatesWidth > 0 &&
    coordinatesHeight > 0
  ) {
    width = coordinatesWidth;
    height = coordinatesHeight;
  } else if (image) {
    const quarterTurn = getQuarterTurn(entry);
    const swapAxes = quarterTurn % 2 === 1;
    width = Math.max(
      1,
      Number(swapAxes ? image.naturalHeight : image.naturalWidth) || 1,
    );
    height = Math.max(
      1,
      Number(swapAxes ? image.naturalWidth : image.naturalHeight) || 1,
    );
  } else {
    return null;
  }

  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return quantizeGridRatio(ratio);
};

const normalizePath = (value: unknown): string =>
  String(value || '').replace(/\\/g, '/');

const isImageInFolderSubtree = (
  relativePath: string,
  folderPath: string,
): boolean => {
  const normalizedRelativePath = normalizePath(relativePath);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRelativePath || !normalizedFolderPath) return false;
  return normalizedRelativePath.startsWith(`${normalizedFolderPath}/`);
};

const buildFolderNodes = (
  images: GalleryImage[],
  rootNames: string[],
): FolderNode[] => {
  const folders = new Map<string, FolderNode>();

  // Ensure root names (from scanned results) are present even if they have no images
  rootNames.forEach((name) => {
    if (!name) return;
    const path = name; // Top-level path is just the directory name
    folders.set(path, {
      path,
      name,
      depth: 0,
      count: 0,
    });
  });

  images.forEach((image) => {
    const relativePath = normalizePath(image?.relativePath);
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length < 2) {
      if (parts.length === 1) {
        // Just a root image
        const path = parts[0];
        const existing = folders.get(path);
        if (existing) {
          existing.count += 1;
        } else {
          folders.set(path, {
            path,
            name: path,
            depth: 0,
            count: 1,
          });
        }
      }
      return;
    }

    const directoryParts = parts.slice(0, -1);
    for (let index = 0; index < directoryParts.length; index += 1) {
      const path = directoryParts.slice(0, index + 1).join('/');
      const existing = folders.get(path);
      if (existing) {
        existing.count += 1;
        continue;
      }
      folders.set(path, {
        path,
        name: directoryParts[index],
        depth: index,
        count: 1,
      });
    }
  });

  return Array.from(folders.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
};

const getQuarterTurn = (entry: CropEntry | undefined): number => {
  const rotate = Number(entry?.transforms?.rotate || 0);
  if (!Number.isFinite(rotate)) return 0;
  const normalized = ((rotate % 360) + 360) % 360;
  return Math.round(normalized / 90) % 4;
};

const hasGridLayoutAffectingChange = (
  previousEntry: CropEntry | undefined,
  nextEntry: CropEntry | undefined,
  image?: GalleryImage,
): boolean => {
  const prevRatio = getGridRatioSignature(previousEntry, image);
  const nextRatio = getGridRatioSignature(nextEntry, image);
  if (prevRatio !== nextRatio) return true;

  // Fallback when no explicit crop size exists yet.
  if (!prevRatio && !nextRatio) {
    return getQuarterTurn(previousEntry) !== getQuarterTurn(nextEntry);
  }

  return false;
};

const approxEqual = (a: number, b: number, tolerance = 0.51) =>
  Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;

const normalizeRotation = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value % 360) + 360) % 360;
  return normalized > 359.999 ? 0 : normalized;
};

const getRotatedBounds = (width: number, height: number, rotation: number) => {
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

const clampStoredCoordinatesToBounds = (
  coordinates: unknown,
  bounds: { width: number; height: number },
): StoredCoordinates | null => {
  const normalized = normalizeStoredCoordinates(coordinates);
  if (!normalized) return null;

  const maxWidth = Math.max(1, Number(bounds?.width) || 1);
  const maxHeight = Math.max(1, Number(bounds?.height) || 1);

  const width = Math.max(1, Math.min(Math.round(normalized.width), maxWidth));
  const height = Math.max(1, Math.min(Math.round(normalized.height), maxHeight));

  const maxLeft = Math.max(0, maxWidth - width);
  const maxTop = Math.max(0, maxHeight - height);
  const left = Math.max(0, Math.min(Math.round(normalized.left), maxLeft));
  const top = Math.max(0, Math.min(Math.round(normalized.top), maxTop));

  return {
    left,
    top,
    width,
    height,
  };
};

const normalizeEditorView = (
  editorView: Partial<EditorViewState> | undefined,
): EditorViewState => {
  const zoom = Number(editorView?.zoom);
  const anchorX = Number(editorView?.anchor?.x);
  const anchorY = Number(editorView?.anchor?.y);
  return {
    zoom: Number.isFinite(zoom) ? Math.max(1, zoom) : 1,
    anchor: {
      x: Number.isFinite(anchorX) ? anchorX : 0.5,
      y: Number.isFinite(anchorY) ? anchorY : 0.5,
    },
  };
};

const hasAnyPadding = (padding: PaddingValues) =>
  padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0;

const hasAnyCornerRadius = (radius: CornerRadiusValues) =>
  radius.topLeft > 0 ||
  radius.topRight > 0 ||
  radius.bottomRight > 0 ||
  radius.bottomLeft > 0;

const hasMeaningfulImageChange = (
  entry: CropEntry | undefined,
  image: GalleryImage | undefined,
) => {
  if (!entry) return false;

  const rotate = normalizeRotation(Number(entry?.transforms?.rotate || 0));
  const flipHorizontal = Boolean(entry?.transforms?.flip?.horizontal);
  const flipVertical = Boolean(entry?.transforms?.flip?.vertical);
  if (rotate > 0.001 || flipHorizontal || flipVertical) return true;

  if (entry?.aspect !== null && entry?.aspect !== undefined) return true;

	  const outputWidth = Number(entry?.outputWidth ?? 0);
	  if (Number.isFinite(outputWidth) && outputWidth > 0) return true;

	  if (entry?.clearImageMetadata) return true;

	  const sourceEditIndex = Number(entry?.sourceEditHistoryIndex ?? -1);
	  const sourceEditHistoryLen = Array.isArray(entry?.sourceEditHistory)
	    ? entry?.sourceEditHistory.length
	    : 0;
	  if (
	    (Number.isFinite(sourceEditIndex) && sourceEditIndex >= 0) ||
	    sourceEditHistoryLen > 0
	  ) {
	    return true;
	  }

	  const normalizedPadding = normalizePaddingInput(entry?.padding);
	  if (hasAnyPadding(normalizedPadding)) return true;

  const normalizedCornerRadius = normalizeCornerRadiusInput(entry?.cornerRadius);
  if (hasAnyCornerRadius(normalizedCornerRadius)) return true;

  const editorView = normalizeEditorView(entry?.editorView);
  if (Math.abs(editorView.zoom - 1) > 0.0001) return true;
  if (editorView.zoom > 1.0001) {
    if (Math.abs(editorView.anchor.x - 0.5) > 0.0001) return true;
    if (Math.abs(editorView.anchor.y - 0.5) > 0.0001) return true;
  }

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

const normalizeCropEntry = (
  entry: CropEntry | null | undefined,
): CropEntry => {
  if (!entry || typeof entry !== 'object') return {};
  return {
    ...entry,
    coordinates: toStoredCoordinates(entry.coordinates),
    editorView: normalizeEditorView(entry.editorView),
  };
};

const normalizeCropEntryForImage = (
  entry: CropEntry | null | undefined,
  image: GalleryImage | undefined,
): CropEntry => {
  const normalizedEntry = normalizeCropEntry(entry);
  const rotate = normalizeRotation(
    Number(normalizedEntry?.transforms?.rotate || 0),
  );
  const imageWidth = Math.max(
    1,
    Number(image?.naturalWidth || normalizedEntry.imageWidth || 1),
  );
  const imageHeight = Math.max(
    1,
    Number(image?.naturalHeight || normalizedEntry.imageHeight || 1),
  );
  const bounds = getRotatedBounds(imageWidth, imageHeight, rotate);

  return {
    ...normalizedEntry,
    coordinates: clampStoredCoordinatesToBounds(normalizedEntry.coordinates, bounds),
    imageWidth,
    imageHeight,
  };
};

const SESSION_MODIFIED_THROTTLE_MS = 750;
const getNowTs = () => Date.now();

type PersistedDraftPayload = {
  cropEntriesById?: Record<string, CropEntry>;
  captionsById?: Record<string, string>;
  excludedById?: Record<string, boolean>;
  modifiedAtById?: Record<string, number>;
};

type ApplyCropToImagesOptions = {
  includeCaption?: boolean;
  includeTransforms?: boolean;
  includeCropState?: boolean;
  includeUiTweaks?: boolean;
  includeWatermarkRemoval?: boolean;
  includeBackgroundRemoval?: boolean;
};

export interface UseStoreState {
  images: GalleryImage[];
  cropData: Map<string, CropEntry>;
  captionById: Map<string, string>;
  excludedById: Map<string, boolean>;
  sessionModifiedAt: Map<string, number>;
  cropLayoutVersion: number;
  folderNodes: FolderNode[];
  selectedId: string | null;
  rowHeight: number;
  format: ExportFormat;
  quality: number;
  showAllFooters: boolean;
  inspectorWidth: number;
  explorerWidth: number;
  sortOption: SortOption;
  rootNames: string[];
  setImages: (images: RawUploadImage[], rootNames?: string[]) => Promise<void>;
  addImages: (
    newImages: RawUploadImage[],
    rootNames?: string[],
  ) => Promise<void>;
  ensureImageMetadata: (id: string | null | undefined) => void;
  deleteImage: (id: string) => void;
  restoreImage: (id: string) => void;
  clearImages: () => void;
  deleteFolder: (folderPath: string) => void;
  clearDraftsForFolder: (folderPath: string) => void;
  setSelectedId: (id: string | null) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setCropChange: (id: string, coords: CropEntry) => void;
  applyCropToImages: (
    sourceId: string,
    targetIds: string[],
    options?: ApplyCropToImagesOptions,
  ) => void;
  setCaptionForImage: (id: string, caption: string) => void;
  resetCaptionForImage: (id: string) => void;
  applyPersistedImageDrafts: (payload: PersistedDraftPayload) => void;
  setRowHeight: (rowHeight: number) => void;
  setFormat: (format: ExportFormat) => void;
  setQuality: (quality: number) => void;
  setShowAllFooters: (showAllFooters: boolean) => void;
  setInspectorWidth: (inspectorWidth: number) => void;
  setExplorerWidth: (explorerWidth: number) => void;
  setSortOption: (sortOption: SortOption) => void;
  expandedPaths: Set<string>;
  toggleExpandedPath: (path: string) => void;
  setExpandedPaths: (paths: Set<string>) => void;
  lastUsedHardware: string | null;
  setLastUsedHardware: (hardware: string | null) => void;
}

const useStore = create<UseStoreState>((set, get) => {
  const metadataQueue: string[] = [];
  const queuedMetadataIds = new Set<string>();
  const inFlightMetadataIds = new Set<string>();
  let metadataWorkerRunning = false;

  const resetPendingMetadataQueue = () => {
    metadataQueue.length = 0;
    queuedMetadataIds.clear();
  };

  const removeIdsFromMetadataQueue = (ids: Iterable<string>) => {
    const removeSet = new Set(
      Array.from(ids)
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    if (removeSet.size === 0) return;

    removeSet.forEach((id) => queuedMetadataIds.delete(id));
    if (metadataQueue.length === 0) return;

    for (let index = metadataQueue.length - 1; index >= 0; index -= 1) {
      if (removeSet.has(metadataQueue[index])) {
        metadataQueue.splice(index, 1);
      }
    }
  };

  const applyMetadataBatch = (
    updates: Array<{ id: string; width: number; height: number }>,
  ) => {
    if (updates.length === 0) return;
    const updatesById = new Map(
      updates.map((entry) => [entry.id, entry] as const),
    );

    set((state) => {
      if (state.images.length === 0) return {};
      let didChange = false;
      const nextImages = state.images.map((image) => {
        const next = updatesById.get(image.id);
        if (!next) return image;
        const width = Math.max(1, Number(next.width) || 1);
        const height = Math.max(1, Number(next.height) || 1);
        const ratio = width / height;

        if (
          image.dimensionsLoaded &&
          image.naturalWidth === width &&
          image.naturalHeight === height
        ) {
          return image;
        }

        didChange = true;
        return {
          ...image,
          naturalWidth: width,
          naturalHeight: height,
          naturalRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
          dimensionsLoaded: true,
        };
      });

      if (!didChange) return {};
      return { images: nextImages };
    });
  };

  const runMetadataHydrationWorker = async () => {
    if (metadataWorkerRunning) return;
    metadataWorkerRunning = true;

    try {
      let pendingUpdates: Array<{ id: string; width: number; height: number }> =
        [];
      while (true) {
        const nextIds: string[] = [];
        while (
          nextIds.length < METADATA_HYDRATION_CONCURRENCY &&
          metadataQueue.length > 0
        ) {
          const id = metadataQueue.shift();
          if (!id) continue;
          if (!queuedMetadataIds.delete(id)) continue;
          nextIds.push(id);
          inFlightMetadataIds.add(id);
        }

        if (nextIds.length === 0) break;

        const imagesById = new Map(
          get().images.map((image) => [image.id, image] as const),
        );

        const results = await Promise.all(
          nextIds.map(async (id) => {
            const image = imagesById.get(id);
            if (!image || image.dimensionsLoaded) {
              inFlightMetadataIds.delete(id);
              return null;
            }

            try {
              const { width, height } = await loadNaturalDimensions(image);
              return { id, width, height };
            } catch {
              return { id, width: 1, height: 1 };
            } finally {
              inFlightMetadataIds.delete(id);
            }
          }),
        );

        const updates = results.filter(Boolean) as Array<{
          id: string;
          width: number;
          height: number;
        }>;
        pendingUpdates = [...pendingUpdates, ...updates];
        if (
          pendingUpdates.length >= METADATA_HYDRATION_BATCH_SIZE ||
          (metadataQueue.length === 0 && inFlightMetadataIds.size === 0)
        ) {
          applyMetadataBatch(pendingUpdates);
          pendingUpdates = [];
        }
        await yieldToMainThread();
      }

      if (pendingUpdates.length > 0) {
        applyMetadataBatch(pendingUpdates);
      }
    } finally {
      metadataWorkerRunning = false;
      if (metadataQueue.length > 0) {
        void runMetadataHydrationWorker();
      }
    }
  };

  const queueImageMetadataHydration = (
    ids: string[],
    options: { priority?: boolean } = {},
  ) => {
    const normalizedIds = ids
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (normalizedIds.length === 0) return;

    if (options.priority) {
      for (let index = normalizedIds.length - 1; index >= 0; index -= 1) {
        const id = normalizedIds[index];
        if (queuedMetadataIds.has(id) || inFlightMetadataIds.has(id)) continue;
        queuedMetadataIds.add(id);
        metadataQueue.unshift(id);
      }
    } else {
      normalizedIds.forEach((id) => {
        if (queuedMetadataIds.has(id) || inFlightMetadataIds.has(id)) return;
        queuedMetadataIds.add(id);
        metadataQueue.push(id);
      });
    }

    void runMetadataHydrationWorker();
  };

  const buildImageShells = async (
    rawImages: RawUploadImage[],
  ): Promise<GalleryImage[]> => {
    const CHUNK_SIZE = 500;
    const nextImages: GalleryImage[] = [];
    for (let index = 0; index < rawImages.length; index += CHUNK_SIZE) {
      const chunk = rawImages.slice(index, index + CHUNK_SIZE);
      nextImages.push(...chunk.map(toGalleryImageShell));
      if (index + CHUNK_SIZE < rawImages.length) {
        await yieldToMainThread();
      }
    }
    return nextImages;
  };

  return {
    // --- Global State ---
    images: [],
    cropData: new Map<string, CropEntry>(),
    captionById: new Map<string, string>(),
    excludedById: new Map<string, boolean>(),
    sessionModifiedAt: new Map<string, number>(),
    cropLayoutVersion: 0,
    folderNodes: [],
    rootNames: [],
    selectedId: null,

    // --- UI Settings ---
    rowHeight: 250,
    format: 'png',
    quality: 90,
    showAllFooters: true,
    inspectorWidth: getDefaultInspectorWidth(),
    explorerWidth: getDefaultExplorerWidth(),
    sortOption: 'last_modified',
    expandedPaths: new Set<string>(),
    lastUsedHardware: null,

    // --- Actions ---

    setLastUsedHardware: (hardware) => set({ lastUsedHardware: hardware }),

    // Images
    setImages: async (rawImages, rootNames) => {
      const safeRawImages = Array.isArray(rawImages) ? rawImages : [];
      const previousImages = get().images;
      resetPendingMetadataQueue();
      previousImages.forEach((image) => revokeImageObjectUrl(image));

      if (safeRawImages.length === 0) {
        set((state) => {
          const nextRootNames = rootNames || state.rootNames;
          return {
            images: [],
            rootNames: nextRootNames,
            folderNodes: buildFolderNodes([], nextRootNames),
            selectedId: null,
          };
        });
        return;
      }

      const nextImages = await buildImageShells(safeRawImages);
      const nextImageIds = nextImages
        .filter((image) => !image.dimensionsLoaded)
        .map((image) => image.id);

      set((state) => {
        const nextRootNames = rootNames || state.rootNames;
        return {
          images: nextImages,
          rootNames: nextRootNames,
          folderNodes: buildFolderNodes(nextImages, nextRootNames),
          selectedId: nextImages.some((img) => img.id === state.selectedId)
            ? state.selectedId
            : null,
        };
      });

      queueImageMetadataHydration(nextImageIds);
      const nextSelectedId = get().selectedId;
      if (nextSelectedId) {
        queueImageMetadataHydration([nextSelectedId], { priority: true });
      }
    },

    addImages: async (rawImages, rootNames) => {
      if (
        !Array.isArray(rawImages) ||
        (rawImages.length === 0 && (!rootNames || rootNames.length === 0))
      ) {
        if (rootNames && rootNames.length > 0) {
          set((state) => {
            const nextRootNames = Array.from(
              new Set([...state.rootNames, ...rootNames]),
            );
            return {
              rootNames: nextRootNames,
              folderNodes: buildFolderNodes(state.images, nextRootNames),
            };
          });
        }
        return;
      }

      const existingIds = new Set(get().images.map((img) => img.id));
      const existingAbsolutePaths = new Set(
        get()
          .images.map((img) => normalizePath(img.absolutePath || ''))
          .filter(Boolean),
      );
      const seenCandidateIds = new Set<string>();
      const seenCandidatePaths = new Set<string>();
      const candidateRaw = rawImages.filter((img) => {
        const imageId = String(img?.id || '').trim();
        const absolutePath = normalizePath(img?.absolutePath || '');

        if (!imageId) return false;
        if (existingIds.has(imageId) || seenCandidateIds.has(imageId)) {
          return false;
        }
        seenCandidateIds.add(imageId);

        if (!absolutePath) return true;
        if (
          existingAbsolutePaths.has(absolutePath) ||
          seenCandidatePaths.has(absolutePath)
        ) {
          return false;
        }
        seenCandidatePaths.add(absolutePath);
        return true;
      });
      if (candidateRaw.length === 0) {
        if (rootNames && rootNames.length > 0) {
          set((state) => {
            const nextRootNames = Array.from(
              new Set([...state.rootNames, ...rootNames]),
            );
            return {
              rootNames: nextRootNames,
              folderNodes: buildFolderNodes(state.images, nextRootNames),
            };
          });
        }
        return;
      }

      const hydrated = await buildImageShells(candidateRaw);
      let queuedIds: string[] = [];

      set((state) => {
        const currentImages = state.images;
        const currentIds = new Set<string>();
        const currentAbsolutePaths = new Set<string>();
        const dedupedCurrent: GalleryImage[] = [];
        const removedDuplicateIds: string[] = [];

        currentImages.forEach((img) => {
          const absolutePath = normalizePath(img.absolutePath || '');
          if (currentIds.has(img.id)) {
            removedDuplicateIds.push(img.id);
            return;
          }
          if (absolutePath && currentAbsolutePaths.has(absolutePath)) {
            removedDuplicateIds.push(img.id);
            return;
          }

          currentIds.add(img.id);
          if (absolutePath) {
            currentAbsolutePaths.add(absolutePath);
          }
          dedupedCurrent.push(img);
        });

        const validNew: GalleryImage[] = [];
        hydrated.forEach((img) => {
          const absolutePath = normalizePath(img.absolutePath || '');
          if (currentIds.has(img.id)) {
            revokeImageObjectUrl(img);
            return;
          }
          if (absolutePath && currentAbsolutePaths.has(absolutePath)) {
            revokeImageObjectUrl(img);
            return;
          }
          currentIds.add(img.id);
          if (absolutePath) {
            currentAbsolutePaths.add(absolutePath);
          }
          validNew.push(img);
        });
        queuedIds = validNew
          .filter((img) => !img.dimensionsLoaded)
          .map((img) => img.id);

        const nextImages = [...dedupedCurrent, ...validNew];
        const nextRootNames = rootNames?.length
          ? Array.from(new Set([...state.rootNames, ...rootNames]))
          : state.rootNames;

        const nextImageIds = new Set(nextImages.map((img) => img.id));
        const staleIds = removedDuplicateIds.filter(
          (id) => !nextImageIds.has(id),
        );

        if (staleIds.length === 0) {
          return {
            images: nextImages,
            rootNames: nextRootNames,
            folderNodes: buildFolderNodes(nextImages, nextRootNames),
          };
        }

        const nextCropData = new Map<string, CropEntry>(state.cropData);
        const nextCaptionById = new Map<string, string>(state.captionById);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );
        staleIds.forEach((id) => {
          nextCropData.delete(id);
          nextCaptionById.delete(id);
          nextSessionModifiedAt.delete(id);
        });

        return {
          images: nextImages,
          rootNames: nextRootNames,
          folderNodes: buildFolderNodes(nextImages, nextRootNames),
          cropData: nextCropData,
          captionById: nextCaptionById,
          sessionModifiedAt: nextSessionModifiedAt,
          selectedId:
            state.selectedId && nextImageIds.has(state.selectedId)
              ? state.selectedId
              : null,
        };
      });

      if (queuedIds.length > 0) {
        queueImageMetadataHydration(queuedIds);
      }
      const nextSelectedId = get().selectedId;
      if (nextSelectedId) {
        queueImageMetadataHydration([nextSelectedId], { priority: true });
      }
    },

    ensureImageMetadata: (id) => {
      const safeId = String(id || '').trim();
      if (!safeId) return;

      const target = get().images.find((image) => image.id === safeId);
      if (!target || target.dimensionsLoaded) return;
      queueImageMetadataHydration([safeId], { priority: true });
    },

    deleteImage: (id) => {
      removeIdsFromMetadataQueue([id]);
      set((state) => {
        const nextExcludedById = new Map<string, boolean>(state.excludedById);
        nextExcludedById.set(id, true);

        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );
        nextSessionModifiedAt.set(id, getNowTs());

        return {
          excludedById: nextExcludedById,
          folderNodes: buildFolderNodes(
            state.images.filter((img) => !nextExcludedById.has(img.id)),
            state.rootNames,
          ),
          sessionModifiedAt: nextSessionModifiedAt,
          selectedId: state.selectedId === id ? null : state.selectedId,
        };
      });
    },

    restoreImage: (id) => {
      const safeId = String(id || '').trim();
      if (!safeId) return;

      set((state) => {
        if (!state.excludedById.has(safeId)) return {};

        const nextExcludedById = new Map<string, boolean>(state.excludedById);
        nextExcludedById.delete(safeId);

        const image = state.images.find((img) => img.id === safeId);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );
        const hasCaptionOverride = state.captionById.has(safeId);
        const hasCropChange = hasMeaningfulImageChange(
          state.cropData.get(safeId),
          image,
        );

        if (hasCropChange || hasCaptionOverride) {
          if (!nextSessionModifiedAt.has(safeId)) {
            nextSessionModifiedAt.set(safeId, getNowTs());
          }
        } else {
          nextSessionModifiedAt.delete(safeId);
        }

        return {
          excludedById: nextExcludedById,
          folderNodes: buildFolderNodes(
            state.images.filter((img) => !nextExcludedById.has(img.id)),
            state.rootNames,
          ),
          sessionModifiedAt: nextSessionModifiedAt,
        };
      });
    },

    clearImages: () => {
      const { images } = get();
      removeIdsFromMetadataQueue(images.map((img) => img.id));
      resetPendingMetadataQueue();
      images.forEach((img) => {
        revokeImageObjectUrl(img);
      });
      set({
        images: [],
        folderNodes: [],
        rootNames: [],
        cropData: new Map<string, CropEntry>(),
        captionById: new Map<string, string>(),
        excludedById: new Map<string, boolean>(),
        sessionModifiedAt: new Map<string, number>(),
        selectedId: null,
      });
    },

    deleteFolder: (folderPath) => {
      const normalizedFolderPath = String(folderPath || '').replace(/\\/g, '/');
      if (!normalizedFolderPath) return;
      const folderPrefix = normalizedFolderPath.endsWith('/')
        ? normalizedFolderPath
        : `${normalizedFolderPath}/`;
      let removedIds: string[] = [];

      set((state) => {
        const nextImages = state.images.filter(
          (img) =>
            !img.relativePath.startsWith(folderPrefix) &&
            img.relativePath !== normalizedFolderPath,
        );

        const nextRootNames = state.rootNames.filter(
          (name) => name !== normalizedFolderPath,
        );

        const nextCropData = new Map<string, CropEntry>(state.cropData);
        const nextCaptionById = new Map<string, string>(state.captionById);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );

        removedIds = state.images
          .filter((img) => !nextImages.some((ni) => ni.id === img.id))
          .map((img) => img.id);

        removedIds.forEach((id) => {
          nextCropData.delete(id);
          nextCaptionById.delete(id);
          nextSessionModifiedAt.delete(id);
          const img = state.images.find((i) => i.id === id);
          revokeImageObjectUrl(img);
        });

        return {
          images: nextImages,
          rootNames: nextRootNames,
          folderNodes: buildFolderNodes(nextImages, nextRootNames),
          cropData: nextCropData,
          captionById: nextCaptionById,
          sessionModifiedAt: nextSessionModifiedAt,
          selectedId:
            state.selectedId &&
            nextImages.some((img) => img.id === state.selectedId)
              ? state.selectedId
              : null,
        };
      });

      if (removedIds.length > 0) {
        removeIdsFromMetadataQueue(removedIds);
      }
    },

    clearDraftsForFolder: (folderPath) => {
      const normalizedFolderPath = String(folderPath || '').replace(/\\/g, '/');
      if (!normalizedFolderPath) return;

      set((state) => {
        let didChange = false;
        let shouldBumpLayoutVersion = false;
        const nextCropData = new Map<string, CropEntry>(state.cropData);
        const nextCaptionById = new Map<string, string>(state.captionById);
        const nextExcludedById = new Map<string, boolean>(state.excludedById);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );

        state.images.forEach((image) => {
          const relativePath = normalizePath(image?.relativePath);
          if (!isImageInFolderSubtree(relativePath, normalizedFolderPath)) {
            return;
          }

          if (nextCaptionById.delete(image.id)) {
            didChange = true;
          }
          if (nextExcludedById.delete(image.id)) {
            didChange = true;
          }
          if (nextSessionModifiedAt.delete(image.id)) {
            didChange = true;
          }

          const previousEntry = nextCropData.get(image.id);
          if (!previousEntry) return;
          nextCropData.delete(image.id);
          didChange = true;
          if (hasGridLayoutAffectingChange(previousEntry, undefined, image)) {
            shouldBumpLayoutVersion = true;
          }
        });

        if (!didChange) return {};
        return {
          cropData: nextCropData,
          captionById: nextCaptionById,
          excludedById: nextExcludedById,
          folderNodes: buildFolderNodes(
            state.images.filter((img) => !nextExcludedById.has(img.id)),
            state.rootNames,
          ),
          sessionModifiedAt: nextSessionModifiedAt,
          cropLayoutVersion: shouldBumpLayoutVersion
            ? state.cropLayoutVersion + 1
            : state.cropLayoutVersion,
        };
      });
    },
    // Selection
    setSelectedId: (id) => {
      set({ selectedId: id });
      if (!id) return;
      get().ensureImageMetadata(id);
    },

    selectNext: () => {
      const { images, selectedId } = get();
      if (!selectedId) return;
      const idx = images.findIndex((img) => img.id === selectedId);
      if (idx < images.length - 1) get().setSelectedId(images[idx + 1].id);
    },

    selectPrev: () => {
      const { images, selectedId } = get();
      if (!selectedId) return;
      const idx = images.findIndex((img) => img.id === selectedId);
      if (idx > 0) get().setSelectedId(images[idx - 1].id);
    },

    // Crop Data
    setCropChange: (id, coords) => {
      set((state) => {
        const nextCropData = new Map(state.cropData);
        const previousEntry = nextCropData.get(id);
        const image = state.images.find((img) => img.id === id);
        const normalizedCoords = normalizeCropEntryForImage(coords, image);
        nextCropData.set(id, normalizedCoords);

        const isInteracting = Boolean(normalizedCoords.isInteracting);

        const isMeaningfulChange = hasMeaningfulImageChange(
          normalizedCoords,
          image,
        );
        const now = getNowTs();
        const previousModifiedAt = state.sessionModifiedAt.get(id) || 0;
        let nextSessionModifiedAt = state.sessionModifiedAt;

        // Avoid thrashing global UI (grid/layout) while actively dragging in the editor.
        // We'll commit a final non-interacting state on drag end.
        if (!isInteracting && isMeaningfulChange) {
          if (
            previousModifiedAt === 0 ||
            now - previousModifiedAt >= SESSION_MODIFIED_THROTTLE_MS
          ) {
            nextSessionModifiedAt = new Map<string, number>(
              state.sessionModifiedAt,
            );
            nextSessionModifiedAt.set(id, now);
          }
        } else if (!isInteracting && previousModifiedAt > 0) {
          if (!state.captionById.has(id)) {
            nextSessionModifiedAt = new Map<string, number>(
              state.sessionModifiedAt,
            );
            nextSessionModifiedAt.delete(id);
          }
        }

        const shouldBumpLayoutVersion = hasGridLayoutAffectingChange(
          previousEntry,
          normalizedCoords,
          image,
        );

        return {
          cropData: nextCropData,
          sessionModifiedAt: nextSessionModifiedAt,
          cropLayoutVersion: shouldBumpLayoutVersion
            ? isInteracting
              ? state.cropLayoutVersion
              : state.cropLayoutVersion + 1
            : state.cropLayoutVersion,
        };
      });
    },

	    applyCropToImages: (sourceId, targetIds, options) => {
	      const { images, cropData } = get();
	      const sourceImg = images.find((img) => img.id === sourceId);
	      if (!sourceImg) return;

      const sourceRawData = cropData.get(sourceId);
      if (!sourceRawData) return;
	      const sourceData = normalizeCropEntryForImage(sourceRawData, sourceImg);
	      const sourceOps = Array.isArray(sourceData?.sourceEditOps)
	        ? (sourceData.sourceEditOps as Array<'watermark' | 'background'>)
	        : [];
	      const shouldIncludeWatermarkRemoval = Boolean(
	        options?.includeWatermarkRemoval && sourceOps.includes('watermark'),
	      );
	      const shouldIncludeBackgroundRemoval = Boolean(
	        options?.includeBackgroundRemoval && sourceOps.includes('background'),
	      );
	      const bulkSourceEditOpsToApply = sourceOps.filter((op) =>
	        op === 'watermark' ? shouldIncludeWatermarkRemoval : shouldIncludeBackgroundRemoval,
	      );
      const sourceCoordinates = normalizeStoredCoordinates(
        sourceData.coordinates,
      );
      const hasSourceCoordinates = Boolean(sourceCoordinates);

      const uniqueTargetIds = Array.from(
        new Set(
          (Array.isArray(targetIds) ? targetIds : [])
            .map((id) => String(id || '').trim())
            .filter((id) => Boolean(id) && id !== sourceId),
        ),
      );
      if (uniqueTargetIds.length === 0) return;

      const imagesById = new Map(
        images.map((image) => [image.id, image] as const),
      );
      const transforms = sourceData.transforms || {
        rotate: 0,
        flip: { horizontal: false, vertical: false },
      };
      const rotate = Number(transforms.rotate) || 0;
      const sourceBounds = getRotatedBounds(
        sourceImg.naturalWidth,
        sourceImg.naturalHeight,
        rotate,
      );
      const sourceW = Math.max(1, sourceBounds.width);
      const sourceH = Math.max(1, sourceBounds.height);

      const relLeft = hasSourceCoordinates
        ? (sourceCoordinates?.left || 0) / sourceW
        : 0;
      const relTop = hasSourceCoordinates
        ? (sourceCoordinates?.top || 0) / sourceH
        : 0;
      const relWidth = hasSourceCoordinates
        ? (sourceCoordinates?.width || sourceW) / sourceW
        : 1;
      const relHeight = hasSourceCoordinates
        ? (sourceCoordinates?.height || sourceH) / sourceH
        : 1;

      set((state) => {
        const nextCropData = new Map(state.cropData);
        const sourceHasCaptionOverride = state.captionById.has(sourceId);
        const shouldCopyCaption = Boolean(options?.includeCaption);
        const sourceCaptionOverride = sourceHasCaptionOverride
          ? String(state.captionById.get(sourceId) ?? '')
          : '';
        const nextCaptionById = shouldCopyCaption
          ? new Map<string, string>(state.captionById)
          : null;
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );
        const now = getNowTs();
        let shouldBumpLayoutVersion = false;

	        uniqueTargetIds.forEach((id) => {
	          const targetImg = imagesById.get(id);
	          if (!targetImg) return;

          const targetBounds = getRotatedBounds(
            targetImg.naturalWidth,
            targetImg.naturalHeight,
            rotate,
          );
          const targetW = Math.max(1, targetBounds.width);
          const targetH = Math.max(1, targetBounds.height);

          const previousEntry = nextCropData.get(id);

          const applyTransforms = options?.includeTransforms ?? true;
          const applyCropState = options?.includeCropState ?? true;
          const applyUiTweaks = options?.includeUiTweaks ?? true;

          // Start with a blank slate, merging from previous target entry or source entry conditionally
          let baseTransforms = applyTransforms
            ? transforms
            : previousEntry?.transforms || {
                rotate: 0,
                flip: { horizontal: false, vertical: false },
              };

	          let mergedEntry: CropEntry = {
	            ...sourceData,
	            transforms: baseTransforms,
	            imageWidth: targetImg.naturalWidth,
	            imageHeight: targetImg.naturalHeight,
	          };
	          // Never copy source-edited pixels across images. Keep the target's own edit history unless
	          // a bulk edit is explicitly requested (handled asynchronously after this set()).
	          mergedEntry.sourceEditHistory = previousEntry?.sourceEditHistory;
	          mergedEntry.sourceEditHistoryIndex = previousEntry?.sourceEditHistoryIndex;
	          mergedEntry.sourceEditOps = previousEntry?.sourceEditOps;

          // Override Crop/Aspect State
          if (!applyCropState) {
            mergedEntry.coordinates = previousEntry?.coordinates;
            mergedEntry.aspect = previousEntry?.aspect;
            mergedEntry.editorView = previousEntry?.editorView;
          } else {
            mergedEntry.coordinates = hasSourceCoordinates
              ? {
                  left: relLeft * targetW,
                  top: relTop * targetH,
                  width: relWidth * targetW,
                  height: relHeight * targetH,
                }
              : null;
          }

          // Override UI Tweaks
          if (!applyUiTweaks) {
            mergedEntry.padding = previousEntry?.padding;
            mergedEntry.cornerRadius = previousEntry?.cornerRadius;
            mergedEntry.paddingMode = previousEntry?.paddingMode;
            mergedEntry.paddingFillType = previousEntry?.paddingFillType;
            mergedEntry.paddingFillValue = previousEntry?.paddingFillValue;
            mergedEntry.paddingImageUrl = previousEntry?.paddingImageUrl;
            mergedEntry.outputWidth = previousEntry?.outputWidth;
          }

          const nextEntry = normalizeCropEntryForImage(mergedEntry, targetImg);

          nextCropData.set(id, nextEntry);

          if (nextCaptionById) {
            if (sourceHasCaptionOverride) {
              nextCaptionById.set(id, sourceCaptionOverride);
            } else {
              nextCaptionById.delete(id);
            }
          }

          const hasCaptionOverride = nextCaptionById
            ? nextCaptionById.has(id)
            : state.captionById.has(id);
          const shouldMarkModified =
            hasMeaningfulImageChange(nextEntry, targetImg) ||
            hasCaptionOverride;
          if (shouldMarkModified) {
            nextSessionModifiedAt.set(id, now);
          } else {
            nextSessionModifiedAt.delete(id);
          }

          if (
            hasGridLayoutAffectingChange(previousEntry, nextEntry, targetImg)
          ) {
            shouldBumpLayoutVersion = true;
          }
        });
        return {
          cropData: nextCropData,
          ...(nextCaptionById ? { captionById: nextCaptionById } : {}),
          sessionModifiedAt: nextSessionModifiedAt,
          cropLayoutVersion: shouldBumpLayoutVersion
            ? state.cropLayoutVersion + 1
            : state.cropLayoutVersion,
        };
	      });

	      if (bulkSourceEditOpsToApply.length === 0) return;

	      // Apply the selected heavy edits (watermark removal / background removal) to each target image.
	      // Runs in the background; export will reflect results once completed.
	      void (async () => {
	        for (const id of uniqueTargetIds) {
	          const img = get().images.find((entry) => entry.id === id);
	          const absolutePath = String(img?.absolutePath || '').trim();
	          if (!img || !absolutePath) continue;

	          const history: string[] = [];
	          const ops: Array<'watermark' | 'background'> = [];
	          let lastDeviceUsed: string | undefined;

	          for (const op of bulkSourceEditOpsToApply) {
	            try {
	              if (op === 'watermark') {
	                const result = await invoke<{ imageBase64: string; deviceUsed?: string }>(
	                  'remove_watermark_single',
	                  { imagePath: absolutePath, maxBboxPercent: 10.0 },
	                );
	                history.push(result.imageBase64);
	                ops.push('watermark');
	                lastDeviceUsed = result.deviceUsed;
	              } else {
	                const result = await invoke<{ imageBase64: string; deviceUsed?: string }>(
	                  'remove_background_single',
	                  { imagePath: absolutePath },
	                );
	                history.push(result.imageBase64);
	                ops.push('background');
	                lastDeviceUsed = result.deviceUsed;
	              }
	            } catch (error) {
	              console.error(`Bulk ${op} failed for image ${id}:`, error);
	              break;
	            }
	            await yieldToMainThread();
	          }

	          if (lastDeviceUsed) {
	            try {
	              get().setLastUsedHardware(lastDeviceUsed);
	            } catch {}
	          }

	          if (history.length === 0) continue;

	          const previousEntry = get().cropData.get(id) || {};
	          get().setCropChange(id, {
	            ...previousEntry,
	            sourceEditHistory: history,
	            sourceEditHistoryIndex: history.length - 1,
	            sourceEditOps: ops,
	          });

	          await yieldToMainThread();
	        }
	      })();
	    },

    setCaptionForImage: (id, caption) => {
      set((state) => {
        const nextCaption = String(caption ?? '');
        const hadCaptionOverride = state.captionById.has(id);
        const previousCaption = hadCaptionOverride
          ? String(state.captionById.get(id) ?? '')
          : '';
        if (hadCaptionOverride && previousCaption === nextCaption) {
          return {};
        }

        const nextCaptionById = new Map<string, string>(state.captionById);
        nextCaptionById.set(id, nextCaption);

        const image = state.images.find((img) => img.id === id);
        const entry = state.cropData.get(id);
        const hasMeaningfulCrop = hasMeaningfulImageChange(entry, image);
        const hasMeaningfulCaptionOverride = nextCaptionById.has(id);
        const shouldMarkModified =
          hasMeaningfulCrop || hasMeaningfulCaptionOverride;

        let nextSessionModifiedAt = state.sessionModifiedAt;
        const previousModifiedAt = state.sessionModifiedAt.get(id) || 0;
        const now = getNowTs();

        if (shouldMarkModified) {
          if (
            previousModifiedAt === 0 ||
            now - previousModifiedAt >= SESSION_MODIFIED_THROTTLE_MS
          ) {
            nextSessionModifiedAt = new Map<string, number>(
              state.sessionModifiedAt,
            );
            nextSessionModifiedAt.set(id, now);
          }
        } else if (previousModifiedAt > 0) {
          nextSessionModifiedAt = new Map<string, number>(
            state.sessionModifiedAt,
          );
          nextSessionModifiedAt.delete(id);
        }

        return {
          captionById: nextCaptionById,
          sessionModifiedAt: nextSessionModifiedAt,
        };
      });
    },

    resetCaptionForImage: (id) => {
      set((state) => {
        if (!state.captionById.has(id)) return {};

        const nextCaptionById = new Map<string, string>(state.captionById);
        nextCaptionById.delete(id);

        const image = state.images.find((img) => img.id === id);
        const entry = state.cropData.get(id);
        const hasMeaningfulCrop = hasMeaningfulImageChange(entry, image);
        const wasMarkedModified = state.sessionModifiedAt.has(id);
        let nextSessionModifiedAt = state.sessionModifiedAt;

        if (hasMeaningfulCrop) {
          if (!wasMarkedModified) {
            nextSessionModifiedAt = new Map<string, number>(
              state.sessionModifiedAt,
            );
            nextSessionModifiedAt.set(id, getNowTs());
          }
        } else if (wasMarkedModified) {
          nextSessionModifiedAt = new Map<string, number>(
            state.sessionModifiedAt,
          );
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
      excludedById,
      modifiedAtById,
    }) => {
      set((state) => {
        const nextCropData = new Map<string, CropEntry>(state.cropData);
        const nextCaptionById = new Map<string, string>(state.captionById);
        const nextExcludedById = new Map<string, boolean>(state.excludedById);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );

        let shouldBumpLayoutVersion = false;
        const imagesById = new Map(
          state.images.map((image) => [image.id, image]),
        );
        const entries = cropEntriesById ? Object.entries(cropEntriesById) : [];

        entries.forEach(([id, value]) => {
          const previousEntry = nextCropData.get(id);
          const normalizedValue = normalizeCropEntryForImage(
            value,
            imagesById.get(id),
          );
          nextCropData.set(id, normalizedValue);
          if (
            hasGridLayoutAffectingChange(
              previousEntry,
              normalizedValue,
              imagesById.get(id),
            )
          ) {
            shouldBumpLayoutVersion = true;
          }
        });

        if (captionsById) {
          Object.entries(captionsById).forEach(([id, value]) => {
            const nextCaption = String(value ?? '');
            nextCaptionById.set(id, nextCaption);
          });
        }

        if (excludedById) {
          Object.entries(excludedById).forEach(([id, value]) => {
            if (value) {
              nextExcludedById.set(id, true);
            } else {
              nextExcludedById.delete(id);
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
          excludedById: nextExcludedById,
          folderNodes: buildFolderNodes(
            state.images.filter((img) => !nextExcludedById.has(img.id)),
            state.rootNames,
          ),
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
    setQuality: (quality) =>
      set((state) => ({ quality: Math.max(1, Math.min(100, quality)) })),
    setShowAllFooters: (showAllFooters) => set({ showAllFooters }),
    setInspectorWidth: (width) => {
      // Basic bounds check to avoid shrinking completely or overflowing
      const minWidth = 360;
      const maxWidth =
        typeof window !== 'undefined' ? window.innerWidth * 0.96 : 1800;
      const validWidth = Math.max(minWidth, Math.min(maxWidth, width));
      set({ inspectorWidth: validWidth });
    },
    setExplorerWidth: (width) => {
      // Sensible bounds check for sidebar width
      const minWidth = 180;
      const maxWidth =
        typeof window !== 'undefined' ? window.innerWidth * 0.4 : 600;
      const safeMax = Math.max(minWidth + 100, Math.min(500, maxWidth));
      const validWidth = Math.max(minWidth, Math.min(safeMax, width));
      set({ explorerWidth: validWidth });
    },
    setSortOption: (sortOption) =>
      set({
        sortOption:
          sortOption === 'last_modified' ||
          sortOption === 'last_modified_oldest' ||
          sortOption === 'name_asc' ||
          sortOption === 'name_desc' ||
          sortOption === 'size_desc' ||
          sortOption === 'size_asc' ||
          sortOption === 'shuffle'
            ? sortOption
            : 'last_modified',
      }),

    // Expanded Paths
    toggleExpandedPath: (path) =>
      set((state) => {
        const next = new Set(state.expandedPaths);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { expandedPaths: next };
      }),
    setExpandedPaths: (expandedPaths) => set({ expandedPaths }),
  };
});

export default useStore;
