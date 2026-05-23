import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import {
  normalizeStoredCoordinates,
  toStoredCoordinates,
} from '../utils/cropCoordinates';
import { normalizeCornerRadiusInput, normalizePaddingInput } from '../utils/boxValues';
import { truncateFilename } from '../utils/textUtils';
import type {
  ApplyCropToImagesOptions,
  CornerRadiusValues,
  CropEntry,
  EditorViewState,
  ExportFormat,
  FolderNode,
  GalleryImage,
  ImageFilterType,
  PaddingValues,
  ProcessingStatus,
  RawUploadImage,
  SortOption,
  SortOrder,
  StoredCoordinates,
  AiProviderSettings,
  CaptioningSettings,
  CaptioningStatus,
  WatermarkSidecarStatus,
  WatermarkRegion,
  Toast,
  ToastType,
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
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');

const isImageInFolderSubtree = (
  relativePath: string,
  folderPath: string,
): boolean => {
  const normalizedRelativePath = normalizePath(relativePath);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRelativePath || !normalizedFolderPath) return false;
  return (
    normalizedRelativePath === normalizedFolderPath ||
    normalizedRelativePath.startsWith(`${normalizedFolderPath}/`)
  );
};

const isImageDirectlyInFolder = (
  relativePath: string,
  folderPath: string,
): boolean => {
  const normalizedRelativePath = normalizePath(relativePath);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRelativePath || !normalizedFolderPath) return false;

  const relParts = normalizedRelativePath.split('/').filter(Boolean);
  const folderParts = normalizedFolderPath.split('/').filter(Boolean);

  // For a direct match, the image must be in the folder, so one more part (the filename)
  if (relParts.length !== folderParts.length + 1) return false;

  return normalizedRelativePath.startsWith(`${normalizedFolderPath}/`);
};

const buildFolderNodes = (
  allImages: GalleryImage[],
  excludedById: Map<string, boolean>,
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
      totalCount: 0,
    });
  });

  allImages.forEach((image) => {
    const isExcluded = excludedById.has(image.id);
    const relativePath = normalizePath(image?.relativePath);
    const parts = relativePath.split('/').filter(Boolean);

    const updateFolder = (path: string, name: string, depth: number) => {
      const existing = folders.get(path);
      if (existing) {
        existing.totalCount += 1;
        if (!isExcluded) {
          existing.count += 1;
        }
      } else {
        folders.set(path, {
          path,
          name,
          depth,
          count: isExcluded ? 0 : 1,
          totalCount: 1,
        });
      }
    };

    if (parts.length < 2) {
      if (parts.length === 1) {
        // Just a root image
        updateFolder(parts[0], parts[0], 0);
      }
      return;
    }

    const directoryParts = parts.slice(0, -1);
    for (let index = 0; index < directoryParts.length; index += 1) {
      const path = directoryParts.slice(0, index + 1).join('/');
      updateFolder(path, directoryParts[index], index);
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

// ApplyCropToImagesOptions is now imported from ../types/app

export interface UseStoreState {
  images: GalleryImage[];
  cropData: Map<string, CropEntry>;
  captionById: Map<string, string>;
  captionErrorById: Map<string, string>;
  excludedById: Map<string, boolean>;
  sessionModifiedAt: Map<string, number>;
  folderLastModified: Map<string, number>;
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
  sortOrder: SortOrder;
  rootNames: string[];
  showExcluded: boolean;
  setShowExcluded: (showExcluded: boolean) => void;
  activeFilters: Set<ImageFilterType>;
  toggleFilter: (filter: ImageFilterType) => void;
  clearFilters: () => void;
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
  updateCropEntry: (id: string, updates: Partial<CropEntry>) => void;
  applyCropToImages: (
    sourceId: string,
    targetIds: string[],
    options?: ApplyCropToImagesOptions,
  ) => void;
  setCaptionForImage: (id: string, caption: string) => void;
  setCaptionError: (id: string, error: string) => void;
  clearCaptionError: (id: string) => void;
  resetCaptionForImage: (id: string) => void;
  applyPersistedImageDrafts: (payload: PersistedDraftPayload) => void;
  setRowHeight: (rowHeight: number) => void;
  setFormat: (format: ExportFormat) => void;
  setQuality: (quality: number) => void;
  setShowAllFooters: (showAllFooters: boolean) => void;
  setInspectorWidth: (inspectorWidth: number) => void;
  setExplorerWidth: (explorerWidth: number) => void;
  setSortOption: (sortOption: SortOption) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  updateFolderLastModified: (path: string, lastModified: number) => void;
  refreshImagesForFolder: (
    folderPath: string,
    newImages: RawUploadImage[],
  ) => Promise<void>;
  expandedPaths: Set<string>;
  toggleExpandedPath: (path: string) => void;
  setExpandedPaths: (paths: Set<string>) => void;
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;
  findAndReplaceCaptions: (find: string, replace: string, scope: 'all' | 'current') => void;
  lastUsedHardware: string | null;
  setLastUsedHardware: (hardware: string | null) => void;
  autoUnload: boolean;
  setAutoUnload: (autoUnload: boolean) => void;
  processingState: ProcessingStatus;
  setProcessingState: (state: Partial<ProcessingStatus>) => void;
  settingsModal: {
    isOpen: boolean;
    activeTab: SettingsTab;
  };
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  captioningSettings: CaptioningSettings;
  setCaptioningSettings: (settings: Partial<CaptioningSettings>) => void;
  updateProviderSettings: (
    provider: 'google' | 'openai' | 'anthropic' | 'openrouter' | 'custom',
    settings: Partial<AiProviderSettings> | Partial<CaptioningSettings['custom']> | any,
  ) => void;
  toasts: Toast[];
  addToast: (message: string, type: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
  isSingleEditMode: boolean;
  isVirtualBatch: boolean;
  virtualBatchName: string | null;
  setSingleEditMode: (active: boolean) => void;
  setVirtualBatchMode: (active: boolean, name?: string | null) => void;
  captioningStatusById: Map<string, CaptioningStatus>;
  enqueueCaptionRequest: (imageId: string, imageAbsolutePath: string) => void;
  cancelCaptionRequest: (imageId: string) => void;
  aiLogs: LogEntry[];
  addAiLog: (log: LogEntry) => void;
  clearAiLogs: () => void;
  isEngineSettingUp: boolean;
  setIsEngineSettingUp: (loading: boolean) => void;
}

export type SettingsTab = 'engine' | 'captioning' | 'tips';
export type LogEntry = {
  timestamp: number;
  message: string;
  isError?: boolean;
};

const useStore = create<UseStoreState>()(
  persist(
    (set, get) => {
  const metadataQueue: string[] = [];
  const queuedMetadataIds = new Set<string>();
  const inFlightMetadataIds = new Set<string>();
  let metadataWorkerRunning = false;

  const captionQueue: Array<{ id: string; path: string }> = [];
  const activeCaptionRequests = new Set<string>();

  const processCaptionQueue = async () => {
    const maxConcurrent = get().captioningSettings.maxConcurrentRequests || 1;
    if (activeCaptionRequests.size >= maxConcurrent) return;

    const nextItem = captionQueue.shift();
    if (!nextItem) return;

    activeCaptionRequests.add(nextItem.id);
    
    // Update status to processing
    const currentStatus = get().captioningStatusById;
    const nextStatus = new Map(currentStatus);
    nextStatus.set(nextItem.id, 'processing');
    set({ captioningStatusById: nextStatus });

    const captioningSettings = get().captioningSettings;
    const providerSettings = captioningSettings[captioningSettings.provider];
    
    try {
      const result = await invoke<{ caption: string; raw_response?: string }>('generate_ai_caption', {
        imagePath: nextItem.path,
        provider: captioningSettings.provider,
        model: 'model' in providerSettings ? providerSettings.model : '',
        apiKey: 'apiKey' in providerSettings ? providerSettings.apiKey : '',
        systemPrompt: captioningSettings.systemPrompt,
        ...(captioningSettings.provider === 'custom' ? {
          endpoint: captioningSettings.custom.endpoint,
          customBodyTemplate: captioningSettings.custom.customBodyTemplate,
          customHeaders: captioningSettings.custom.customHeaders,
          responseField: captioningSettings.custom.responseField,
        } : {}),
        timeout: captioningSettings.timeout || 180,
      });

      if (result?.caption) {
        get().setCaptionForImage(nextItem.id, result.caption);
        if (captioningSettings.provider === 'custom' && result.raw_response) {
          get().updateProviderSettings('custom', { lastResponse: result.raw_response });
        }
        get().addToast('Caption generated successfully!', 'success');
      }
    } catch (error) {
      console.error('Failed to generate AI caption for', nextItem.id, error);
      get().addToast(String(error) || 'Failed to generate AI caption', 'error');
    } finally {
      activeCaptionRequests.delete(nextItem.id);
      
      const updatedStatus = new Map(get().captioningStatusById);
      updatedStatus.delete(nextItem.id);
      set({ captioningStatusById: updatedStatus });

      // Run again
      processCaptionQueue();
    }
  };

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
    images: [] as GalleryImage[],
    cropData: new Map<string, CropEntry>(),
    captionById: new Map<string, string>(),
    captionErrorById: new Map<string, string>(),
    excludedById: new Map<string, boolean>(),
    sessionModifiedAt: new Map<string, number>(),
    folderLastModified: new Map<string, number>(),
    cropLayoutVersion: 0,
    folderNodes: [] as FolderNode[],
    rootNames: [] as string[],
    selectedId: null as string | null,
    showExcluded: false,
    activeFilters: new Set<ImageFilterType>(),

    setShowExcluded: (showExcluded) => set({ showExcluded }),

    toggleFilter: (filter) =>
      set((state) => {
        const next = new Set(state.activeFilters);
        if (next.has(filter)) {
          next.delete(filter);
        } else {
          next.add(filter);
        }
        return { activeFilters: next };
      }),

    clearFilters: () => set({ activeFilters: new Set() }),

    // --- UI Settings ---
    rowHeight: 250,
    format: 'png',
    quality: 100,
    showAllFooters: true,
    inspectorWidth: getDefaultInspectorWidth(),
    explorerWidth: getDefaultExplorerWidth(),
    sortOption: 'last_modified',
    sortOrder: 'desc',
    expandedPaths: new Set<string>(),
    lastUsedHardware: null as string | null,
    autoUnload: true,
    processingState: {
      total: 0,
      current: 0,
      statusText: '',
      isMinimized: false,
      isActive: false,
      estimatedTimeRemaining: undefined as number | undefined,
    },

    captioningSettings: {
      provider: 'google',
      google: {
        model: 'gemini-2.0-flash',
        apiKey: '',
      },
      openai: {
        model: 'gpt-4o-mini',
        apiKey: '',
      },
      anthropic: {
        model: 'claude-3-5-sonnet-latest',
        apiKey: '',
      },
      openrouter: {
        model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
        apiKey: '',
      },
      custom: {
        apiKey: '',
        endpoint: '',
        customBodyTemplate: JSON.stringify({
          model: '{{model}}',
          messages: [{ role: 'user', content: [
            { type: 'text', text: '{{prompt}}' },
            { type: 'image_url', image_url: { url: '{{image}}' } }
          ]}]
        }, null, 2),
        customHeaders: '',
        responseField: 'choices[0].message.content',
        lastResponse: '',
      },
      systemPrompt:
        'Generate a concise and accurate caption for this image. Focus on the main subject and key details.',
      timeout: 180,
      maxAttempts: 3,
    },

    toasts: [] as Toast[],
    isSingleEditMode: false,
    isVirtualBatch: false,
    virtualBatchName: null as string | null,

    captioningStatusById: new Map<string, CaptioningStatus>(),

    enqueueCaptionRequest: (imageId: string, imageAbsolutePath: string) => {
      // Don't enqueue if it's already queued or processing
      if (get().captioningStatusById.has(imageId)) return;
      
      const newStatus = new Map(get().captioningStatusById);
      newStatus.set(imageId, 'queued');
      set({ captioningStatusById: newStatus });

      captionQueue.push({ id: imageId, path: imageAbsolutePath });
      
      // Attempt to process queue
      processCaptionQueue();
    },

    cancelCaptionRequest: (imageId: string) => {
      // If it's already processing, we can't really cancel the Tauri side easily,
      // but we can remove it from the queue if it's just queued.
      const status = get().captioningStatusById.get(imageId);
      if (status === 'queued') {
        const index = captionQueue.findIndex(item => item.id === imageId);
        if (index !== -1) {
          captionQueue.splice(index, 1);
        }
        const newStatus = new Map(get().captioningStatusById);
        newStatus.delete(imageId);
        set({ captioningStatusById: newStatus });
      }
    },

    setSingleEditMode: (active: boolean) =>
      set({
        isSingleEditMode: active,
        isVirtualBatch: false,
        virtualBatchName: null,
      }),

    setVirtualBatchMode: (active: boolean, name: string | null = null) =>
      set({
        isVirtualBatch: active,
        isSingleEditMode: false,
        virtualBatchName: name,
      }),

    addToast: (message: string, type: ToastType, duration = 3500) => {
      const id = Math.random().toString(36).substring(2, 9);
      set((state) => ({
        toasts: [...state.toasts, { id, message, type, duration }],
      }));

      if (duration > 0) {
        setTimeout(() => {
          const currentToasts = get().toasts;
          if (currentToasts.some((t) => t.id === id)) {
            get().removeToast(id);
          }
        }, duration);
      }
    },

    removeToast: (id: string) =>
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      })),

    // --- Actions ---

    setLastUsedHardware: (hardware) => set({ lastUsedHardware: hardware }),
    setAutoUnload: (autoUnload) => set({ autoUnload }),

    setCaptioningSettings: (next) =>
      set((state) => ({
        captioningSettings: { ...state.captioningSettings, ...next },
      })),

    updateProviderSettings: (provider, settings) =>
      set((state) => ({
        captioningSettings: {
          ...state.captioningSettings,
          [provider]: { ...(state.captioningSettings[provider] as any), ...(settings as any) },
        },
      })),

    setProcessingState: (next: Partial<ProcessingStatus>) =>
      set((state) => ({
        processingState: { ...state.processingState, ...next },
      })),

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
            folderNodes: buildFolderNodes([], state.excludedById, nextRootNames),
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
          folderNodes: buildFolderNodes(nextImages, state.excludedById, nextRootNames),
          selectedId: nextImages.some((img) => img.id === state.selectedId)
            ? state.selectedId
            : null,
          isSingleEditMode: false,
          isVirtualBatch: false,
          virtualBatchName: null,
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
              folderNodes: buildFolderNodes(state.images, state.excludedById, nextRootNames),
              isSingleEditMode: false,
              isVirtualBatch: false,
              virtualBatchName: null,
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
              folderNodes: buildFolderNodes(state.images, state.excludedById, nextRootNames),
              isSingleEditMode: false,
              isVirtualBatch: false,
              virtualBatchName: null,
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
            folderNodes: buildFolderNodes(nextImages, state.excludedById, nextRootNames),
          };
        }

        const nextCropData = new Map<string, CropEntry>(state.cropData);
        const nextCaptionById = new Map<string, string>(state.captionById);
        const nextSessionModifiedAt = new Map<string, number>(
          state.sessionModifiedAt,
        );

        // Pre-populate captions from sidecar text files if provided
        validNew.forEach((img) => {
          if (img.caption && img.caption.trim()) {
            nextCaptionById.set(img.id, img.caption.trim());
          }
        });

        staleIds.forEach((id) => {
          nextCropData.delete(id);
          nextCaptionById.delete(id);
          nextSessionModifiedAt.delete(id);
        });

        return {
          images: nextImages,
          rootNames: nextRootNames,
          folderNodes: buildFolderNodes(nextImages, state.excludedById, nextRootNames),
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

        return {
          excludedById: nextExcludedById,
          folderNodes: buildFolderNodes(
            state.images,
            nextExcludedById,
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
            state.images,
            nextExcludedById,
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
        showExcluded: false,
        cropData: new Map<string, CropEntry>(),
        captionById: new Map<string, string>(),
        excludedById: new Map<string, boolean>(),
        sessionModifiedAt: new Map<string, number>(),
        selectedId: null,
      });
    },

    deleteFolder: (folderPath) => {
      const normalizedFolderPath = String(folderPath || '')
        .replace(/\\/g, '/')
        .trim();
      if (!normalizedFolderPath) return;

      const folderPrefix = normalizedFolderPath.endsWith('/')
        ? normalizedFolderPath
        : `${normalizedFolderPath}/`;

      let removedIds: string[] = [];

      set((state) => {
        // 1. Remove images associated with this folder (or subfolders)
        const nextImages = state.images.filter((img) => {
          const rel = normalizePath(img.relativePath);
          const abs = normalizePath(img.absolutePath || '');
          const isMatch =
            rel === normalizedFolderPath ||
            rel.startsWith(folderPrefix) ||
            abs === normalizedFolderPath ||
            abs.startsWith(folderPrefix);
          return !isMatch;
        });

        // 2. Remove from rootNames. 
        // We check for exact match or if the root name is part of the path.
        const nextRootNames = state.rootNames.filter((name) => {
          const normName = normalizePath(name);
          return (
            normName !== normalizedFolderPath &&
            !normalizedFolderPath.endsWith(`/${normName}`) &&
            !normName.startsWith(folderPrefix)
          );
        });

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
          folderNodes: buildFolderNodes(nextImages, state.excludedById, nextRootNames),
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
            state.images,
            nextExcludedById,
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

    updateCropEntry: (id, updates) => {
      set((state) => {
        const nextCropData = new Map(state.cropData);
        const prev = nextCropData.get(id) || {};
        nextCropData.set(id, { ...prev, ...updates });
        return { cropData: nextCropData };
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
      const shouldIncludeWatermarkRemoval = Boolean(options?.includeWatermarkRemoval);
      const shouldIncludeBackgroundRemoval = Boolean(options?.includeBackgroundRemoval);

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

      const shouldApplyAiCaption = Boolean(options?.includeCaption && options?.captionMode === 'ai');

      set((state) => {
        const nextCropData = new Map(state.cropData);
        const sourceHasCaptionOverride = state.captionById.has(sourceId);
        const shouldCopyCaption = Boolean(options?.includeCaption && options?.captionMode !== 'ai');
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

          const previousEntry = nextCropData.get(id);

          const targetBounds = getRotatedBounds(
            targetImg.naturalWidth,
            targetImg.naturalHeight,
            rotate,
          );
          const targetW = Math.max(1, targetBounds.width);
          const targetH = Math.max(1, targetBounds.height);

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
          // AI Source Edits Sync/Reset
          // If the user wants to include an AI edit, and the source HAS it, we'll re-run it below (async).
          // If the user wants to include an AI edit, and the source HAS NO it, we clear it from targets right now.
          const shouldResetSourceEdits = 
            (options?.includeWatermarkRemoval && !sourceOps.includes('watermark')) ||
            (options?.includeBackgroundRemoval && !sourceOps.includes('background'));

          if (shouldResetSourceEdits) {
            mergedEntry.sourceEditHistory = [];
            mergedEntry.sourceEditHistoryIndex = -1;
            mergedEntry.sourceEditOps = [];
          } else {
            mergedEntry.sourceEditHistory = previousEntry?.sourceEditHistory;
            mergedEntry.sourceEditHistoryIndex = previousEntry?.sourceEditHistoryIndex;
            mergedEntry.sourceEditOps = previousEntry?.sourceEditOps;
          }

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
          }

          // Override Export Resize
          if (!options?.includeExportResize) {
            mergedEntry.outputWidth = previousEntry?.outputWidth;
          } else {
            mergedEntry.outputWidth = sourceData.outputWidth;
          }

          // Override Detection Region
          if (!options?.includeDetectionRegion) {
            mergedEntry.detectionRegion = previousEntry?.detectionRegion;
          } else {
            mergedEntry.detectionRegion = sourceData.detectionRegion;
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

      if (bulkSourceEditOpsToApply.length === 0 && !shouldApplyAiCaption) return;

      // Apply the selected heavy edits (watermark removal / background removal / AI captioning) to each target image.
      // Runs in the background; export will reflect results once completed.
      void (async () => {
        const { setProcessingState, captioningSettings, addToast } = get();
        const totalItems = uniqueTargetIds.length;
        const startTime = Date.now();
        
        setProcessingState({
          isActive: true,
          total: totalItems,
          current: 0,
          statusText: '',
          estimatedTimeRemaining: undefined,
        });

        // Phase 1: Waking up the engine / loading models if needed
        if (bulkSourceEditOpsToApply.length > 0) {
          try {
            const status = await invoke<WatermarkSidecarStatus>('get_watermark_sidecar_status');
            if (!status.isBridgeActive) {
              setProcessingState({ statusText: 'Waking up the AI engine...' });
              await yieldToMainThread();
            } else if (!status.isModelsLoaded || !status.isBgRemovalLoaded) {
              setProcessingState({ statusText: 'Preparing AI models...' });
              await yieldToMainThread();
            }
          } catch (e) {
            console.error('Failed to check initial status:', e);
          }
        }

        const providerSettings = captioningSettings[captioningSettings.provider];
        if (shouldApplyAiCaption && captioningSettings.provider !== 'custom' && !providerSettings.apiKey) {
          addToast(`Please configure API key for ${captioningSettings.provider}`, 'warning');
          setProcessingState({ isActive: false });
          return;
        }

        let currentCount = 0;
        for (const id of uniqueTargetIds) {
          const img = get().images.find((entry) => entry.id === id);
          if (!img) {
            currentCount++;
            setProcessingState({ current: currentCount });
            continue;
          }

          const absolutePath = String(img.absolutePath || '').trim();
          const currentName = img.name || 'image';
          const filename = truncateFilename(currentName, 20);

          // 1. Handle Skip Logic for heavy ops
          const cropState = get().cropData.get(id);
          const existingOps = Array.isArray(cropState?.sourceEditOps) ? cropState?.sourceEditOps : [];
          const opsToRun = bulkSourceEditOpsToApply.filter(op => !existingOps.includes(op));

          // 2. Handle Skip Logic for AI Caption
          const hasExistingCaption = get().captionById.has(id);
          const shouldRunAi = shouldApplyAiCaption && !hasExistingCaption;

          if (opsToRun.length === 0 && !shouldRunAi) {
            currentCount++;
            setProcessingState({ current: currentCount });
            continue;
          }

          // Run heavy physical edits
          if (opsToRun.length > 0 && absolutePath) {
            const history = [...(cropState?.sourceEditHistory || [])];
            const ops = [...(cropState?.sourceEditOps || [])] as Array<'watermark' | 'background'>;
            
            for (let opIdx = 0; opIdx < opsToRun.length; opIdx++) {
              const op = opsToRun[opIdx];
              const isLastOp = currentCount === totalItems - 1 && opIdx === opsToRun.length - 1;
              const shouldAutoUnload = get().autoUnload && isLastOp;

              try {
                const statusMsg = op === 'watermark' 
                  ? `Finding watermarks in ${filename}...`
                  : `Removing background from ${filename}...`;
                
                setProcessingState({ 
                  current: currentCount, 
                  statusText: statusMsg 
                });
                await yieldToMainThread();

                if (op === 'watermark') {
                  const result = await invoke<{ imageBase64: string; deviceUsed?: string }>(
                    'remove_watermark_single',
                    { 
                      imagePath: absolutePath, 
                      maxBboxPercent: 10.0, 
                      autoUnload: shouldAutoUnload,
                      detectionRegion: get().cropData.get(id)?.detectionRegion || null
                    },
                  );
                  history.push(result.imageBase64);
                  ops.push('watermark');
                  if (result.deviceUsed) {
                    try { get().setLastUsedHardware(result.deviceUsed); } catch {}
                  }
                } else {
                  const result = await invoke<{ imageBase64: string; deviceUsed?: string }>(
                    'remove_background_single',
                    { imagePath: absolutePath, autoUnload: shouldAutoUnload },
                  );
                  history.push(result.imageBase64);
                  ops.push('background');
                  if (result.deviceUsed) {
                    try { get().setLastUsedHardware(result.deviceUsed); } catch {}
                  }
                }
              } catch (e) {
                console.error(`Failed bulk ${op}:`, e);
              }
            }

            if (history.length > 0) {
              set((state) => {
                const nextCropData = new Map(state.cropData);
                const current = nextCropData.get(id) || {};
                nextCropData.set(id, {
                  ...current,
                  sourceEditHistory: history,
                  sourceEditHistoryIndex: history.length - 1,
                  sourceEditOps: ops,
                });
                return { cropData: nextCropData };
              });
            }
          }

          // Run AI Captioning
          if (shouldRunAi && absolutePath) {
            const existingCaption = get().captionById.get(id);
            if (existingCaption && existingCaption.trim().length > 0) {
              console.log(`Skipping AI caption for ${filename} - already has caption.`);
            } else {
              const maxAttempts = captioningSettings.maxAttempts || 3;
              const timeout = captioningSettings.timeout || 180;
              let success = false;
              let lastError = null;
              
              for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                  setProcessingState({ 
                    current: currentCount, 
                    statusText: attempt > 1 
                      ? `Generating caption for ${filename} (Attempt ${attempt}/${maxAttempts})...`
                      : `Generating caption for ${filename}...` 
                  });
                  await yieldToMainThread();
 
                  const result = await invoke<{ caption: string; raw_response?: string }>('generate_ai_caption', {
                    imagePath: absolutePath,
                    provider: captioningSettings.provider,
                    model: 'model' in providerSettings ? providerSettings.model : '',
                    apiKey: providerSettings.apiKey,
                    systemPrompt: captioningSettings.systemPrompt,
                    endpoint: 'endpoint' in providerSettings ? (providerSettings as any).endpoint : '',
                    customBodyTemplate: 'customBodyTemplate' in providerSettings ? (providerSettings as any).customBodyTemplate : '',
                    customHeaders: 'customHeaders' in providerSettings ? (providerSettings as any).customHeaders : '',
                    responseField: 'responseField' in providerSettings ? (providerSettings as any).responseField : '',
                    timeout,
                  });

                  if (result?.caption) {
                    get().setCaptionForImage(id, result.caption);
                    get().clearCaptionError(id);
                    success = true;
                    break;
                  }
                } catch (e) {
                  lastError = e;
                  console.warn(`AI caption attempt ${attempt} failed for ${id}:`, e);
                  // Small backoff before retry
                  if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000));
                }
              }

              if (!success) {
                console.error(`Failed bulk AI caption for ${id} after ${maxAttempts} attempts:`, lastError);
                get().setCaptionError(id, String(lastError || 'Unknown error'));
              }

              // Apply RPM delay to avoid rate limits
              await new Promise(r => setTimeout(r, 800));
            }
          }

          currentCount++;
          
          // ETA Calculation
          const elapsed = Date.now() - startTime;
          const avgTimePerImage = elapsed / currentCount;
          const remainingImages = totalItems - currentCount;
          const eta = remainingImages * avgTimePerImage;

          setProcessingState({ 
            current: currentCount,
            estimatedTimeRemaining: eta
          });
          await yieldToMainThread();
        }

        setProcessingState({ 
          statusText: 'All bulk operations completed',
          estimatedTimeRemaining: 0,
        });

        // Auto-hide after a short delay if not minimized
        setTimeout(() => {
          const finalState = get().processingState;
          if (!finalState.isMinimized) {
            setProcessingState({ isActive: false });
          }
        }, 2000);
      })();
    },

    setCaptionForImage: (id: string, caption: string) => {
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
        const nextCaptionErrorById = new Map<string, string>(state.captionErrorById);

        if (nextCaption.length > 0) {
          nextCaptionById.set(id, nextCaption);
          // Auto-clear error when a successful caption is set
          nextCaptionErrorById.delete(id);
        } else {
          nextCaptionById.delete(id);
        }

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
          captionErrorById: nextCaptionErrorById,
          sessionModifiedAt: nextSessionModifiedAt,
        };
      });
    },

    setCaptionError: (id: string, error: string) => {
      set((state) => {
        const nextCaptionErrorById = new Map<string, string>(state.captionErrorById);
        nextCaptionErrorById.set(id, error);
        return { captionErrorById: nextCaptionErrorById };
      });
    },

    clearCaptionError: (id: string) => {
      set((state) => {
        if (!state.captionErrorById.has(id)) return {};
        const nextCaptionErrorById = new Map<string, string>(state.captionErrorById);
        nextCaptionErrorById.delete(id);
        return { captionErrorById: nextCaptionErrorById };
      });
    },

    resetCaptionForImage: (id) => {
      set((state) => {
        if (!state.captionById.has(id)) return {};

        const nextCaptionById = new Map<string, string>(state.captionById);
        nextCaptionById.delete(id);

        const nextCaptionErrorById = new Map<string, string>(state.captionErrorById);
        nextCaptionErrorById.delete(id);

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
          }
        } else if (wasMarkedModified) {
          nextSessionModifiedAt = new Map<string, number>(
            state.sessionModifiedAt,
          );
          nextSessionModifiedAt.delete(id);
        }

        return {
          captionById: nextCaptionById,
          captionErrorById: nextCaptionErrorById,
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
            const currentCaption = nextCaptionById.get(id);
            // Don't overwrite a newly loaded sidecar caption with an empty draft
            if (nextCaption.trim() !== '' || !currentCaption || currentCaption.trim() === '') {
              nextCaptionById.set(id, nextCaption);
            }
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
            state.images,
            nextExcludedById,
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
        sortOption: [
          'last_modified',
          'name',
          'size',
          'aspect_ratio',
          'shuffle',
        ].includes(sortOption)
          ? sortOption
          : 'last_modified',
      }),
    setSortOrder: (sortOrder) => set({ sortOrder }),
    
    updateFolderLastModified: (path, lastModified) => {
      set((state) => {
        const next = new Map(state.folderLastModified);
        next.set(normalizePath(path), lastModified);
        return { folderLastModified: next };
      });
    },

    refreshImagesForFolder: async (folderPath, rawNewImages) => {
      const normalizedFolderPath = normalizePath(folderPath);
      if (!normalizedFolderPath) return;

      const newImages = await buildImageShells(rawNewImages);
      const newImageIds = new Set(newImages.map((img) => img.id));
      const nextImageIdsForHydration = newImages
        .filter((img) => !img.dimensionsLoaded)
        .map((img) => img.id);

      set((state) => {
        const currentImages = state.images;
        
        // 1. Remove old images that were in this folder but are gone now
        const filteredCurrent = currentImages.filter((img) => {
          const imgPath = normalizePath(img.relativePath);
          // Only reconcile images that are DIRECTLY in this folder (matching the non-recursive scan)
          const inScope = isImageDirectlyInFolder(imgPath, normalizedFolderPath);
          if (inScope) {
            // Keep it only if it's in the new set
            const exists = newImageIds.has(img.id);
            if (!exists) {
              revokeImageObjectUrl(img);
              return false;
            }
          }
          return true;
        });

        // 2. Map existing images for quick lookup
        const imagesById = new Map(filteredCurrent.map((img) => [img.id, img] as const));
        const nextCaptionById = new Map(state.captionById);

        // 3. Update existing or add new
        const finalImages = [...filteredCurrent];
        newImages.forEach((newImg) => {
          if (newImg.caption && newImg.caption.trim()) {
            nextCaptionById.set(newImg.id, newImg.caption.trim());
          }

          if (imagesById.has(newImg.id)) {
            // Update existing image metadata if needed (though usually we trust our store's dimension cache)
            // For now, let's just keep the existing one to avoid flickering/reloading
            return;
          }
          finalImages.push(newImg);
        });

        return {
          images: finalImages,
          folderNodes: buildFolderNodes(finalImages, state.excludedById, state.rootNames),
          captionById: nextCaptionById,
          selectedId: finalImages.some((img) => img.id === state.selectedId)
            ? state.selectedId
            : null,
        };
      });

      if (nextImageIdsForHydration.length > 0) {
        queueImageMetadataHydration(nextImageIdsForHydration);
      }
    },

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
    isCommandPaletteOpen: false,
    setIsCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
    findAndReplaceCaptions: (findText, replaceText, scope) => {
      set((state) => {
        const nextCaptionById = new Map(state.captionById);
        const imagesToProcess =
          scope === 'current'
            ? state.images.filter((img) => img.id === state.selectedId)
            : state.images;

        let changedCount = 0;
        imagesToProcess.forEach((image) => {
          const currentCaption = nextCaptionById.get(image.id) || '';
          if (currentCaption.includes(findText)) {
            const newCaption = currentCaption.split(findText).join(replaceText);
            nextCaptionById.set(image.id, newCaption);
            changedCount++;
          }
        });

        if (changedCount > 0) {
          return { captionById: nextCaptionById };
        }
        return state;
      });
    },
    settingsModal: {
      isOpen: false,
      activeTab: 'engine',
    },
    openSettings: (tab = 'engine') =>
      set((state) => ({
        settingsModal: { isOpen: true, activeTab: tab },
      })),
    closeSettings: () =>
      set((state) => ({
        settingsModal: { ...state.settingsModal, isOpen: false },
      })),
    aiLogs: [],
    addAiLog: (log) => {
      set((state) => {
        const last = state.aiLogs[state.aiLogs.length - 1];
        if (last && last.message === log.message && last.timestamp === log.timestamp) return state;
        return { aiLogs: [...state.aiLogs, log].slice(-1000) }; // Keep last 1000 lines
      });
    },
    clearAiLogs: () => set({ aiLogs: [] }),
    isEngineSettingUp: false,
    setIsEngineSettingUp: (isEngineSettingUp) => set({ isEngineSettingUp }),
    };
    },
  {
      name: 'beautiful-batches-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        rowHeight: state.rowHeight,
        format: state.format,
        quality: state.quality,
        showAllFooters: state.showAllFooters,
        inspectorWidth: state.inspectorWidth,
        explorerWidth: state.explorerWidth,
        sortOption: state.sortOption,
        lastUsedHardware: state.lastUsedHardware,
        autoUnload: state.autoUnload,
        captioningSettings: {
          ...state.captioningSettings,
          google: { ...(state.captioningSettings.google || {}), apiKey: '' },
          openai: { ...(state.captioningSettings.openai || {}), apiKey: '' },
          anthropic: { ...(state.captioningSettings.anthropic || {}), apiKey: '' },
          openrouter: { ...(state.captioningSettings.openrouter || {}), apiKey: '' },
          custom: { ...(state.captioningSettings.custom || {}), apiKey: '', lastResponse: '' },
        },
      }),
    }
  )
);

export default useStore;
