export type SortOrder = 'asc' | 'desc';

export type SortOption =
  | 'last_modified'
  | 'name'
  | 'size'
  | 'aspect_ratio'
  | 'shuffle';

export type InspectorMode = 'edit' | 'view';

export type ImageFilterType =
  | 'cropped'
  | 'transformed'
  | 'has_caption'
  | 'has_ai_edits'
  | 'has_tweaks'
  | 'has_resize';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface FlipState {
  horizontal: boolean;
  vertical: boolean;
}

export interface EditorAnchor {
  x: number;
  y: number;
}

export interface EditorViewState {
  zoom: number;
  anchor: EditorAnchor;
}

export interface StoredCoordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EditorCropCoordinates {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PaddingValues {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CornerRadiusValues {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export type PaddingMode = 'inner';
export type PaddingFillType = 'empty' | 'color' | 'image';

export interface CropEntry {
  coordinates?: StoredCoordinates | null;
  transforms?: {
    rotate: number;
    flip: FlipState;
  };
  isInteracting?: boolean;
  aspect?: number | null;
  outputWidth?: number | null;
  editorView?: EditorViewState;
  padding?: PaddingValues | string;
  cornerRadius?: CornerRadiusValues | string;
  paddingMode?: PaddingMode;
  paddingFillType?: PaddingFillType;
  paddingFillValue?: string;
  paddingImageUrl?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  clearImageMetadata?: boolean;
  sourceEditHistory?: string[];
  sourceEditHistoryIndex?: number;
  sourceEditOps?: Array<'watermark' | 'background'>;
  detectionRegion?: WatermarkRegion | null;
}

export interface RawUploadImage {
  file: File;
  id: string;
  relativePath: string;
  /** Absolute path on disk (set for native/Tauri images). */
  absolutePath?: string;
  /** Asset-protocol URL for the webview (set for native/Tauri images). */
  assetUrl?: string;
  thumbnailUrl?: string;
  /** File size in bytes from native scan metadata. */
  nativeSize?: number;
  /** Image width in pixels from native scan metadata. */
  nativeWidth?: number;
  /** Image height in pixels from native scan metadata. */
  nativeHeight?: number;
  /** Last accessed timestamp in milliseconds from native scan metadata. */
  nativeAccessedAt?: number;
  /** Creation timestamp in milliseconds from native scan metadata. */
  nativeCreatedAt?: number;
  /** Last modified timestamp in milliseconds from native scan metadata. */
  nativeLastModifiedAt?: number;
  /** Pre-loaded sidecar caption if available. */
  caption?: string;
}

export interface GalleryImage extends RawUploadImage {
  name: string;
  objectUrl: string;
  thumbnailUrl?: string;
  naturalWidth: number;
  naturalHeight: number;
  naturalRatio: number;
  dimensionsLoaded: boolean;
  sourceAccessedAt: number;
  sourceCreatedAt: number;
  sourceLastModified: number;
  sourceSize: number;
  loadedAt: number;
}

export interface FolderNode {
  path: string;
  name: string;
  depth: number;
  count: number;
  totalCount: number;
  expandable?: boolean;
}

export interface FolderDraftSummary {
  folderPath: string;
  count: number;
  updatedAt: number;
}

export interface DraftRestoreItem extends FolderDraftSummary {
  selected: boolean;
}

export interface DraftRestorePrompt {
  items: DraftRestoreItem[];
}

export type FsPermissionState = 'granted' | 'prompt' | 'denied';
export type FsPermissionMode = 'read' | 'readwrite';

export interface FileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  isSameEntry?: (other: DirectoryEntryHandle) => Promise<boolean>;
}

export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterableIterator<[string, DirectoryEntryHandle]>;
  isSameEntry?: (other: DirectoryEntryHandle) => Promise<boolean>;
  queryPermission?: (
    descriptor?: { mode?: FsPermissionMode },
  ) => Promise<FsPermissionState>;
  requestPermission?: (
    descriptor?: { mode?: FsPermissionMode },
  ) => Promise<FsPermissionState>;
  resolve?: (
    possibleDescendant: DirectoryEntryHandle,
  ) => Promise<string[] | null>;
}

export type DirectoryEntryHandle = DirectoryHandle | FileHandle;

export interface DirectoryRoot {
  rootPath: string;
  rootName: string;
  handle: DirectoryHandle | null;
}

export interface ResolvedDraftsById {
  cropEntriesById: Record<string, CropEntry>;
  captionsById: Record<string, string>;
  excludedById: Record<string, boolean>;
  modifiedAtById: Record<string, number>;
  restoredCount: number;
}

// ── Watermark Sidecar ────────────────────────────────────────────────

export type WatermarkModelStatus = {
  id: string;
  name: string;
  description: string;
  downloaded: boolean;
  sizeBytes: number;
  expectedSizeBytes: number;
  modelType: 'detection' | 'inpainting';
};

export type WatermarkSidecarStatus = {
  pythonInstalled: boolean;
  uvInstalled: boolean;
  engineAssetsReady: boolean;
  venvExists: boolean;
  dependenciesInstalled: boolean;
  isBridgeActive: boolean;
  isBridgeBusy: boolean;
  isModelsLoaded: boolean;
  isBgRemovalLoaded: boolean;
  loadedDetectionModel: string | null;
  loadedInpaintingModel: string | null;
  loadedDevice: string | null;
  modelCachePath: string;
  repoPath: string;
  pythonPath: string;
  detectionModels: WatermarkModelStatus[];
  inpaintingModels: WatermarkModelStatus[];
  backgroundRemovalModels: WatermarkModelStatus[];
  totalSizeBytes: number;
  hardwareType: string;
};


export interface WatermarkRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type WatermarkSidecarSettings = {
  useUv: boolean;
  autoUnload: boolean;
  detectionModelId: string;
  inpaintingModelId: string;
  detectionRegion: WatermarkRegion | null;
};

export type ProcessingStatus = {
  total: number;
  current: number;
  statusText: string;
  isMinimized: boolean;
  isActive: boolean;
  estimatedTimeRemaining?: number; // In milliseconds
};

export type CaptioningStatus = 'queued' | 'processing';

export interface AiProviderSettings {
  model: string;
  apiKey: string;
}

export interface CaptioningSettings {
  provider: 'google' | 'openai' | 'anthropic' | 'openrouter' | 'custom';
  google: AiProviderSettings;
  openai: AiProviderSettings;
  anthropic: AiProviderSettings;
  openrouter: AiProviderSettings;
  custom: {
    apiKey: string;
    endpoint: string;
    customBodyTemplate: string;
    customHeaders: string;
    responseField: string;
    lastResponse: string;
  };
  systemPrompt: string;
  timeout?: number;
  maxAttempts?: number;
  maxConcurrentRequests?: number;
}

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export interface ApplyCropToImagesOptions {
  includeCaption?: boolean;
  captionMode?: 'copy' | 'ai';
  includeTransforms?: boolean;
  includeCropState?: boolean;
  includeUiTweaks?: boolean;
  includeWatermarkRemoval?: boolean;
  includeBackgroundRemoval?: boolean;
  includeDetectionRegion?: boolean;
  includeExportResize?: boolean;
}

export interface NativeScannedImage {
  relative_path: string;
  file_name: string;
  absolute_path: string;
  size: number;
  accessed_at: number;
  created_at: number;
  last_modified: number;
  width: number;
  height: number;
  caption?: string;
}

export interface NativeRootScan {
  root_path: string;
  directory_name: string;
  images: NativeScannedImage[];
}

export type AppMode = 'explorer' | 'single-edit' | 'virtual-batch';
