import { invoke } from '@tauri-apps/api/core';
import type {
  DirectoryHandle,
  FolderNode,
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
  width: number;
  height: number;
};

type NativeRootScan = {
  rootPath: string;
  directoryName: string;
  images: NativeScannedImage[];
};

type NativeDirectoryChild = {
  path: string;
  name: string;
  depth: number;
};

type NativeSidecarCaptionResult = {
  exists: boolean;
  content: string;
};

type NativePickAndScanRootResult = {
  cancelled: boolean;
  root: NativeRootScan | null;
  savedRootPaths: string[];
};

export type NativeLoadSavedRootsResult = {
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

const buildNativeUploadId = (
  image: NativeScannedImage,
  relativePath: string,
): string => {
  const absolutePath = normalizePath(image.absolutePath);
  if (absolutePath) {
    return `native:${absolutePath}`;
  }
  return `native:${relativePath}`;
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
    id: buildNativeUploadId(image, relativePath),
    relativePath,
    absolutePath: image.absolutePath,
    assetUrl,
    thumbnailUrl,
    nativeSize: image.size,
    nativeWidth: Number(image.width || 0) || undefined,
    nativeHeight: Number(image.height || 0) || undefined,
  };
};

export const flattenNativeRootScans = (
  roots: NativeRootScan[],
): RawUploadImage[] => {
  const images: RawUploadImage[] = [];
  roots.forEach((root) => {
    root.images.forEach((image) => {
      if (Number(image?.size || 0) <= 0) return;
      if (Number(image?.width || 0) <= 0 || Number(image?.height || 0) <= 0) {
        return;
      }
      images.push(nativeScannedImageToRawUpload(image));
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
      rootNames?: string[];
      rootPath?: string;
    };

export const pickImagesFromDirectory = async (): Promise<PickImagesFromDirectoryResult> => {
  if (isTauriRuntime()) {
    const result =
      await invoke<NativePickAndScanRootResult>('pick_and_scan_root');
    if (result.cancelled) {
      return {
        supported: true,
        aborted: true,
        images: [],
      };
    }

    if (!result.root) {
      return {
        supported: true,
        aborted: false,
        images: [],
        rootPaths: Array.isArray(result.savedRootPaths)
          ? result.savedRootPaths
              .map((value) => normalizePath(value))
              .filter(Boolean)
          : [],
      };
    }

    return {
      supported: true,
      aborted: false,
      images: flattenNativeRootScans([result.root]),
      directoryName: result.root.directoryName,
      rootPath: normalizePath(result.root.rootPath),
      rootNames: [result.root.directoryName],
      rootPaths: Array.isArray(result.savedRootPaths)
        ? result.savedRootPaths
            .map((value) => normalizePath(value))
            .filter(Boolean)
        : [],
    };
  }

  if (!canUseFsDirectoryPicker()) {
    return { supported: false, aborted: false, images: [] };
  }

  try {
    const directoryHandle = await (
      window as WindowWithDirectoryPicker
    ).showDirectoryPicker?.();
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
      rootPath: normalizePath(directoryHandle.name),
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
      rootNames?: string[];
      rootPath?: string;
    };

export const loadImagesFromSavedDirectory = async (
  options: { promptForPermission?: boolean } = {},
): Promise<LoadSavedDirectoryResult> => {
  const { promptForPermission = false } = options;
  if (isTauriRuntime()) {
    const result = await invoke<NativeLoadSavedRootsResult>(
      'load_saved_roots_and_scan',
    );
    const hasSavedRoots =
      Array.isArray(result.savedRootPaths) && result.savedRootPaths.length > 0;
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
      rootPath: roots[0] ? normalizePath(roots[0].rootPath) : '',
      rootNames: roots.map((r) => r.directoryName),
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

export const loadSavedRootPaths = async (): Promise<string[]> => {
  if (!isTauriRuntime()) return [];
  try {
    const result = await invoke<string[]>('load_saved_roots_metadata');
    if (!Array.isArray(result)) return [];
    return result.map((value) => normalizePath(value)).filter(Boolean);
  } catch {
    return [];
  }
};

export const loadSidecarCaptionForImagePath = async (
  absolutePath: string,
): Promise<NativeSidecarCaptionResult> => {
  const normalizedPath = normalizePath(absolutePath);
  if (!isTauriRuntime() || !normalizedPath) {
    return { exists: false, content: '' };
  }

  try {
    const result = await invoke<NativeSidecarCaptionResult>(
      'read_sidecar_caption_for_image',
      {
        imagePath: normalizedPath,
      },
    );
    return {
      exists: Boolean(result?.exists),
      content: typeof result?.content === 'string' ? result.content : '',
    };
  } catch {
    return { exists: false, content: '' };
  }
};

export const scanImagesFromRootPath = async (
  rootPath: string,
): Promise<PickImagesFromDirectoryResult> => {
  const normalizedRoot = normalizePath(rootPath);
  if (!normalizedRoot || !isTauriRuntime()) {
    return {
      supported: false,
      aborted: false,
      images: [],
    };
  }

  try {
    const root = await invoke<NativeRootScan>('scan_root_by_path', {
      rootPath: normalizedRoot,
    });
    if (!root) {
      return {
        supported: true,
        aborted: false,
        images: [],
        rootPath: normalizedRoot,
      };
    }

    return {
      supported: true,
      aborted: false,
      images: flattenNativeRootScans([root]),
      directoryName: root.directoryName,
      rootPath: normalizePath(root.rootPath || normalizedRoot),
      rootNames: [root.directoryName],
      rootPaths: [normalizePath(root.rootPath || normalizedRoot)],
    };
  } catch {
    return {
      supported: true,
      aborted: false,
      images: [],
      rootPath: normalizedRoot,
    };
  }
};

const toRelativeTail = (rootName: string, folderPath: string): string => {
  const normalizedRootName = normalizePath(rootName);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRootName || !normalizedFolderPath) return '';

  if (normalizedFolderPath === normalizedRootName) return '';
  if (normalizedFolderPath.startsWith(`${normalizedRootName}/`)) {
    return normalizedFolderPath.slice(normalizedRootName.length + 1);
  }
  return '';
};

export const scanImagesFromFolderPath = async (params: {
  rootPath: string;
  rootName: string;
  folderPath: string;
  recursive?: boolean;
  offset?: number;
  limit?: number;
}): Promise<PickImagesFromDirectoryResult> => {
  const normalizedRootPath = normalizePath(params.rootPath);
  const normalizedRootName = normalizePath(params.rootName);
  const normalizedFolderPath = normalizePath(params.folderPath);
  if (
    !isTauriRuntime() ||
    !normalizedRootPath ||
    !normalizedRootName ||
    !normalizedFolderPath
  ) {
    return {
      supported: false,
      aborted: false,
      images: [],
    };
  }

  const relativePath = toRelativeTail(normalizedRootName, normalizedFolderPath);
  try {
    const root = await invoke<NativeRootScan>('scan_folder_by_path_command', {
      rootPath: normalizedRootPath,
      rootName: normalizedRootName,
      relativePath,
      recursive: Boolean(params.recursive),
      offset: Math.max(0, Math.floor(Number(params.offset ?? 0) || 0)),
      limit: Math.max(0, Math.floor(Number(params.limit ?? 0) || 0)),
    });

    if (!root) {
      return {
        supported: true,
        aborted: false,
        images: [],
        directoryName: normalizedRootName,
        rootPath: normalizedRootPath,
        rootNames: [normalizedRootName],
        rootPaths: [normalizedRootPath],
      };
    }

    return {
      supported: true,
      aborted: false,
      images: flattenNativeRootScans([root]),
      directoryName: root.directoryName || normalizedRootName,
      rootPath: normalizePath(root.rootPath || normalizedRootPath),
      rootNames: [root.directoryName || normalizedRootName],
      rootPaths: [normalizePath(root.rootPath || normalizedRootPath)],
    };
  } catch {
    return {
      supported: true,
      aborted: false,
      images: [],
      directoryName: normalizedRootName,
      rootPath: normalizedRootPath,
      rootNames: [normalizedRootName],
      rootPaths: [normalizedRootPath],
    };
  }
};

export const listDirectoryChildren = async (params: {
  rootPath: string;
  rootName: string;
  folderPath: string;
}): Promise<FolderNode[]> => {
  const normalizedRootPath = normalizePath(params.rootPath);
  const normalizedRootName = normalizePath(params.rootName);
  const normalizedFolderPath = normalizePath(params.folderPath);

  if (!isTauriRuntime() || !normalizedRootPath || !normalizedRootName) {
    return [];
  }

  const relativePath = toRelativeTail(normalizedRootName, normalizedFolderPath);

  try {
    const children = await invoke<NativeDirectoryChild[]>(
      'list_directory_children_by_path',
      {
        rootPath: normalizedRootPath,
        rootName: normalizedRootName,
        relativePath,
      },
    );
    if (!Array.isArray(children)) return [];

    return children
      .map(
        (child): FolderNode => ({
          path: normalizePath(child.path),
          name: String(child.name || '').trim(),
          depth: Math.max(0, Number(child.depth || 0)),
          count: 0,
          expandable: true,
        }),
      )
      .filter((child) => Boolean(child.path) && Boolean(child.name))
      .sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
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
