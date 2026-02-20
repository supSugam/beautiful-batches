import { invoke } from '@tauri-apps/api/core';
import type {
  DirectoryHandle,
  RawUploadImage,
} from '../types/app';

/**
 * Convert an absolute file path to a `localfile://` URL served by our custom
 * Rust protocol handler registered in main.rs.
 */
const toLocalFileUrl = (absolutePath: string): string => {
  const encoded = encodeURIComponent(absolutePath).replace(/%2F/g, '/');
  return `localfile://localhost${encoded.startsWith('/') ? '' : '/'}${encoded}`;
};

export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
]);

export const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.webp,.avif';

let uploadSequence = 0;

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
};

type NativeScannedImage = {
  relativePath: string;
  fileName: string;
  absolutePath: string;
  size: number;
  lastModified: number;
};

type NativeRootScan = {
  rootPath: string;
  directoryName: string;
  images: NativeScannedImage[];
};

type NativePickAndScanRootResult = {
  cancelled: boolean;
  root: NativeRootScan | null;
  savedRootPaths: string[];
};

type NativeLoadSavedRootsResult = {
  roots: NativeRootScan[];
  savedRootPaths: string[];
};

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

const normalizePath = (value: unknown): string =>
  String(value || '').replace(/\\/g, '/');

const getExtension = (filename: unknown): string => {
  const safeName = String(filename || '');
  const dotIndex = safeName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return safeName.slice(dotIndex).toLowerCase();
};

const mimeTypeForExtension = (extension: string): string => {
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.avif') return 'image/avif';
  return 'application/octet-stream';
};

const buildUploadId = (prefix: string, relativePath: string): string => {
  uploadSequence += 1;
  return `${prefix}-${Date.now()}-${uploadSequence}-${relativePath}`;
};

/**
 * Convert a native scanned image (path-based) into a RawUploadImage.
 *
 * Instead of decoding base64 into a File, we use Tauri's `convertFileSrc` to
 * turn the absolute disk path into an `asset://` URL that the webview can load
 * directly — zero-copy, streamed from disk.
 */
const nativeScannedImageToRawUpload = (
  image: NativeScannedImage,
  prefix: string,
): RawUploadImage => {
  const extension = getExtension(image.fileName);
  const mimeType = mimeTypeForExtension(extension);
  const relativePath = normalizePath(image.relativePath || image.fileName);

  // Build the asset URL for the webview.
  const assetUrl = toLocalFileUrl(image.absolutePath);
  const thumbnailUrl = `${assetUrl}?thumbnail=true`;

  // Create a minimal File object for compatibility with the existing gallery
  // pipeline. The actual image data is loaded via the asset URL, not from this
  // File.
  const file = new File([], image.fileName, {
    type: mimeType,
    lastModified: Math.max(0, Number(image.lastModified || 0)) * 1000,
  });

  return {
    file,
    id: buildUploadId(prefix, relativePath),
    relativePath,
    absolutePath: image.absolutePath,
    assetUrl,
    thumbnailUrl,
    nativeSize: image.size,
  };
};

const flattenNativeRootScans = (
  roots: NativeRootScan[],
): RawUploadImage[] => {
  const images: RawUploadImage[] = [];
  roots.forEach((root) => {
    const prefix = normalizePath(root.rootPath || root.directoryName || 'root');
    root.images.forEach((image) => {
      images.push(nativeScannedImageToRawUpload(image, prefix));
    });
  });
  return images;
};

export const isImageFile = (file: File | null | undefined): file is File => {
  if (!file) return false;
  return IMAGE_EXTENSIONS.has(getExtension(file.name));
};

export const imagesFromFileList = (
  fileList: FileList | null | undefined,
  prefix = 'files',
): RawUploadImage[] => {
  if (!fileList || typeof fileList.length !== 'number') return [];

  const images: RawUploadImage[] = [];
  for (let index = 0; index < fileList.length; index += 1) {
    const file = fileList[index];
    if (!isImageFile(file)) continue;
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    images.push({
      file,
      id: buildUploadId(prefix, relativePath),
      relativePath,
    });
  }
  return images;
};

const canUseFsDirectoryPicker = () =>
  typeof window !== 'undefined' &&
  typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';

const walkDirectory = async (
  directoryHandle: DirectoryHandle,
  pathSegments: string[],
  collector: RawUploadImage[],
): Promise<void> => {
  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === 'directory') {
      await walkDirectory(
        entryHandle as DirectoryHandle,
        [...pathSegments, entryName],
        collector,
      );
      continue;
    }

    if (entryHandle.kind !== 'file') continue;
    const file = await entryHandle.getFile();
    if (!isImageFile(file)) continue;

    const relativePath = normalizePath([...pathSegments, file.name].join('/'));
    collector.push({
      file,
      id: buildUploadId('dir', relativePath),
      relativePath,
    });
  }
};

export type PickImagesFromDirectoryResult =
  | { supported: false; aborted: false; images: [] }
  | {
      supported: true;
      aborted: boolean;
      images: RawUploadImage[];
      directoryName?: string;
      directoryHandle?: DirectoryHandle;
      rootPaths?: string[];
    };

export const pickImagesFromDirectory = async (): Promise<PickImagesFromDirectoryResult> => {
  if (isTauriRuntime()) {
    const result = await invoke<NativePickAndScanRootResult>('pick_and_scan_root');
    if (result.cancelled) {
      return {
        supported: true,
        aborted: true,
        images: [],
      };
    }

    if (!result.root) {
      return { supported: false, aborted: false, images: [] };
    }

    return {
      supported: true,
      aborted: false,
      images: flattenNativeRootScans([result.root]),
      directoryName: result.root.directoryName,
      rootPaths: Array.isArray(result.savedRootPaths)
        ? result.savedRootPaths.map((value) => normalizePath(value)).filter(Boolean)
        : [],
    };
  }

  if (!canUseFsDirectoryPicker()) {
    return { supported: false, aborted: false, images: [] };
  }

  try {
    const directoryHandle = await (window as WindowWithDirectoryPicker).showDirectoryPicker?.();
    if (!directoryHandle) {
      return { supported: false, aborted: false, images: [] };
    }

    const images: RawUploadImage[] = [];
    await walkDirectory(directoryHandle, [directoryHandle.name], images);
    return {
      supported: true,
      aborted: false,
      images,
      directoryName: directoryHandle.name,
      directoryHandle,
      rootPaths: [normalizePath(directoryHandle.name)],
    };
  } catch (error) {
    if ((error as DOMException | null)?.name === 'AbortError') {
      return { supported: true, aborted: true, images: [] };
    }
    throw error;
  }
};

export type LoadSavedDirectoryResult =
  | {
      supported: false;
      available: false;
      granted: false;
      images: [];
      directoryName?: string;
      directoryHandle?: DirectoryHandle;
    }
  | {
      supported: true;
      available: boolean;
      granted: boolean;
      images: RawUploadImage[];
      directoryName?: string;
      directoryHandle?: DirectoryHandle;
      rootPaths?: string[];
    };

export const loadImagesFromSavedDirectory = async (
  _options: { promptForPermission?: boolean } = {},
): Promise<LoadSavedDirectoryResult> => {
  if (isTauriRuntime()) {
    const result = await invoke<NativeLoadSavedRootsResult>('load_saved_roots_and_scan');
    const hasSavedRoots = Array.isArray(result.savedRootPaths) && result.savedRootPaths.length > 0;
    const roots = Array.isArray(result.roots) ? result.roots : [];

    if (!hasSavedRoots) {
      return {
        supported: true,
        available: false,
        granted: false,
        images: [],
      };
    }

    const images = flattenNativeRootScans(roots);
    return {
      supported: true,
      available: true,
      granted: true,
      images,
      directoryName: roots[0]?.directoryName || '',
      rootPaths: result.savedRootPaths
        .map((value) => normalizePath(value))
        .filter(Boolean),
    };
  }

  return {
    supported: false,
    available: false,
    granted: false,
    images: [],
  };
};

export const clearSavedDirectoryHandle = async () => {
  if (isTauriRuntime()) {
    return invoke<boolean>('clear_saved_roots');
  }
  return false;
};

export const removeSavedRootByPath = async (rootPath: string): Promise<boolean> => {
  if (!rootPath || !isTauriRuntime()) return false;
  try {
    return await invoke<boolean>('remove_saved_root', { rootPath });
  } catch {
    return false;
  }
};

export const clearSavedDirectoryHandleIfMatches = async (
  _directoryHandle: DirectoryHandle | null | undefined,
): Promise<boolean> => {
  // Native mode does not use browser FileSystemDirectoryHandle tokens.
  // Use removeSavedRootByPath() from App when removing individual linked roots.
  return false;
};
