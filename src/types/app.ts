export type SortOption =
  | 'last_modified'
  | 'last_modified_oldest'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc'
  | 'size_asc';

export type IfFileExistsMode = 'skip' | 'append' | 'overwrite';
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

export type PaddingMode = 'inner' | 'outer';
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
}

export interface GalleryImage extends RawUploadImage {
  name: string;
  objectUrl: string;
  thumbnailUrl?: string;
  naturalWidth: number;
  naturalHeight: number;
  naturalRatio: number;
  dimensionsLoaded: boolean;
  sourceLastModified: number;
  sourceSize: number;
  loadedAt: number;
}

export interface FolderNode {
  path: string;
  name: string;
  depth: number;
  count: number;
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
  modifiedAtById: Record<string, number>;
  restoredCount: number;
}
