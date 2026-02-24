import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderTree,
  HardDriveDownload,
  Image as ImageIcon,
  FileImage,
  FileText,
  Sparkles,
  X,
  Loader2,
} from 'lucide-react';
import type {
  CropEntry,
  ExportFormat,
  FolderNode,
  GalleryImage,
} from '../../types/app';
import { scanImagesFromFolderPath } from '../../utils/directoryPicker';
import SegmentedControl from '../common/SegmentedControl';
import TriStateCheckbox from '../common/TriStateCheckbox';
import './ExportPlanModal.css';

type ExportScope = 'current_image' | 'current_folder' | 'selected_folders';
type DestinationMode = 'folder' | 'zip';
type StructureMode = 'preserve' | 'flatten' | 'one_level';
type ConflictMode = 'auto_rename' | 'skip' | 'overwrite';

type OutputRow = {
  imageId: string;
  sourceName: string;
  sourcePath: string;
  outputPath: string;
  outputWidth: number;
  outputHeight: number;
  isEdited: boolean;
  hasCaption: boolean;
  skipped: boolean;
  collision: boolean;
};

type ExecuteExportPlanItemPayload = {
  imageId: string;
  sourcePath: string;
  sourceName?: string;
  sourceDataBase64?: string;
  outputPath: string;
  caption?: string;
  crop: CropEntry | null;
  skip: boolean;
};

type ExecuteExportPlanRequestPayload = {
  destinationMode: DestinationMode;
  baseFolder: string;
  destinationName: string;
  conflictMode: ConflictMode;
  quality: number;
  clearMetadata: boolean;
  includeCaptions: boolean;
  items: ExecuteExportPlanItemPayload[];
  paddingImageAssets: Record<string, string>;
};

type ExecuteExportPlanResultPayload = {
  destinationPath: string;
  writtenCount: number;
  skippedCount: number;
  captionWrittenCount: number;
  failedCount: number;
  warnings: string[];
};

type ExportPlanModalProps = {
  images: GalleryImage[];
  currentFolderImages: GalleryImage[];
  selectedFolderPaths: Set<string>;
  excludedById: Map<string, boolean>;
  resolveRootForFolderPath: (
    folderPath: string,
  ) => { root: { rootName: string; rootPath: string } } | null;
  folderNodes: FolderNode[];
  selectedId: string | null;
  activeFolderLabel: string;
  activeFolderPathOnDisk?: string;
  format: ExportFormat;
  quality: number;
  cropData: Map<string, CropEntry>;
  captionById: Map<string, string>;
  onEnableFolderSelectionMode?: () => void;
  onClose: () => void;
};

const OUTPUT_PREVIEW_LIMIT = 8;
const REVEAL_SECTION_TRANSITION = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob as base64.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected blob read result.'));
        return;
      }
      const base64 = result.split(',').pop() || '';
      if (!base64) {
        reject(new Error('Base64 payload is empty.'));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });

const normalizePath = (value: string): string =>
  String(value || '').replace(/\\/g, '/');

const toNumericStringList = (value: unknown): number[] => {
  if (typeof value !== 'string') return [];
  return value
    .split(/\s+/)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num));
};

const hasPositiveValue = (value: unknown): boolean =>
  Number.isFinite(Number(value)) && Number(value) > 0;

const hasAnyPadding = (entry: CropEntry | undefined): boolean => {
  const padding = entry?.padding;
  if (!padding) return false;
  if (typeof padding === 'string') {
    return toNumericStringList(padding).some((value) => value > 0);
  }
  return (
    hasPositiveValue(padding.top) ||
    hasPositiveValue(padding.right) ||
    hasPositiveValue(padding.bottom) ||
    hasPositiveValue(padding.left)
  );
};

const hasAnyCornerRadius = (entry: CropEntry | undefined): boolean => {
  const cornerRadius = entry?.cornerRadius;
  if (!cornerRadius) return false;
  if (typeof cornerRadius === 'string') {
    return toNumericStringList(cornerRadius).some((value) => value > 0);
  }
  return (
    hasPositiveValue(cornerRadius.topLeft) ||
    hasPositiveValue(cornerRadius.topRight) ||
    hasPositiveValue(cornerRadius.bottomRight) ||
    hasPositiveValue(cornerRadius.bottomLeft)
  );
};

const getNameWithoutExtension = (name: string): string => {
  const safe = String(name || '').trim();
  const dot = safe.lastIndexOf('.');
  if (dot <= 0) return safe || 'image';
  return safe.slice(0, dot);
};

const getDateToken = (): string => new Date().toISOString().slice(0, 10);

const toExtension = (format: ExportFormat): string => {
  return format;
};

const getParentDirectory = (filePath: string): string => {
  const normalized = normalizePath(filePath);
  if (!normalized) return '';
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '';
  return normalized.slice(0, lastSlash);
};

const joinPath = (...parts: string[]): string =>
  parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');

const pathHasPrefix = (value: string, prefix: string): boolean => {
  const normalizedValue = normalizePath(value).replace(/\/+$/, '');
  const normalizedPrefix = normalizePath(prefix).replace(/\/+$/, '');
  if (!normalizedValue || !normalizedPrefix) return false;
  return (
    normalizedValue === normalizedPrefix ||
    normalizedValue.startsWith(`${normalizedPrefix}/`)
  );
};

const findLongestPrefixMatch = (
  value: string,
  candidates: string[],
): string | null => {
  const normalizedValue = normalizePath(value);
  if (!normalizedValue) return null;
  let best: string | null = null;
  candidates.forEach((candidate) => {
    if (!pathHasPrefix(normalizedValue, candidate)) return;
    if (!best || normalizePath(candidate).length > normalizePath(best).length) {
      best = candidate;
    }
  });
  return best;
};

const getRelativeParentPath = (
  relativePath: string,
  options?: { includeRoot?: boolean },
): string => {
  const includeRoot = options?.includeRoot === true;
  const parts = normalizePath(relativePath).split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  if (includeRoot) {
    return parts.slice(0, -1).join('/');
  }
  if (parts.length <= 2) return '';
  return parts.slice(1, -1).join('/');
};

const sanitizeFileSegment = (value: string): string =>
  String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();

const sanitizeRelativePath = (value: string): string =>
  normalizePath(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizeFileSegment(segment))
    .filter(Boolean)
    .join('/');

const computeOutputDimensions = (
  image: GalleryImage,
  entry: CropEntry | undefined,
): { width: number; height: number } => {
  const sourceWidth = Math.max(
    1,
    Number(entry?.coordinates?.width || image.naturalWidth || 1),
  );
  const sourceHeight = Math.max(
    1,
    Number(entry?.coordinates?.height || image.naturalHeight || 1),
  );
  const outputWidth = Number(entry?.outputWidth || 0);

  if (Number.isFinite(outputWidth) && outputWidth > 0) {
    const ratio = sourceWidth / sourceHeight;
    const height = Math.max(1, Math.round(outputWidth / (ratio || 1)));
    return { width: Math.round(outputWidth), height };
  }
  return { width: Math.round(sourceWidth), height: Math.round(sourceHeight) };
};

const hasCoordinatesChange = (
  entry: CropEntry | undefined,
  image: GalleryImage,
): boolean => {
  const coords = entry?.coordinates;
  if (!coords) return false;
  const left = Number(coords.left || 0);
  const top = Number(coords.top || 0);
  const width = Number(coords.width || 0);
  const height = Number(coords.height || 0);
  const baselineWidth = Math.max(1, Number(image.naturalWidth || 1));
  const baselineHeight = Math.max(1, Number(image.naturalHeight || 1));
  if (Math.abs(left) > 0.001 || Math.abs(top) > 0.001) return true;
  if (Math.abs(width - baselineWidth) > 0.001) return true;
  if (Math.abs(height - baselineHeight) > 0.001) return true;
  return false;
};

const hasMeaningfulImageChange = (
  image: GalleryImage,
  entry: CropEntry | undefined,
  caption: string,
  includeCaptions: boolean,
): boolean => {
  if (includeCaptions && caption.trim().length > 0) return true;
  if (!entry) return false;

  const rotate = Number(entry.transforms?.rotate || 0);
  const flipH = Boolean(entry.transforms?.flip?.horizontal);
  const flipV = Boolean(entry.transforms?.flip?.vertical);
  const outputWidth = Number(entry.outputWidth || 0);
  const aspect = entry.aspect;
  const zoom = Number(entry.editorView?.zoom || 1);
  const anchorX = Number(entry.editorView?.anchor?.x || 0.5);
  const anchorY = Number(entry.editorView?.anchor?.y || 0.5);
  const hasFillChange =
    (entry.paddingFillType && entry.paddingFillType !== 'empty') ||
    Boolean(String(entry.paddingFillValue || '').trim()) ||
    Boolean(entry.paddingImageUrl);

  if (Math.abs(rotate) > 0.001 || flipH || flipV) return true;
  if (aspect !== null && aspect !== undefined) return true;
  if (Number.isFinite(outputWidth) && outputWidth > 0) return true;
  if (hasAnyPadding(entry) || hasAnyCornerRadius(entry)) return true;
  if (Math.abs(zoom - 1) > 0.0001) return true;
  if (Math.abs(anchorX - 0.5) > 0.0001 || Math.abs(anchorY - 0.5) > 0.0001)
    return true;
  if (hasFillChange) return true;
  if (hasCoordinatesChange(entry, image)) return true;
  return false;
};

const addConflictSuffix = (value: string, count: number): string => {
  if (count <= 1) return value;
  const dot = value.lastIndexOf('.');
  if (dot > 0) {
    const name = value.slice(0, dot);
    const ext = value.slice(dot);
    return `${name}_${count}${ext}`;
  }
  return `${value}_${count}`;
};

const formatNamePattern = (
  pattern: string,
  image: GalleryImage,
  index: number,
  indexPadWidth: number,
  activeFolderLabel: string,
): string => {
  const fileBase = getNameWithoutExtension(image.name);
  const formatted = String(pattern || '')
    .replace(/\{name\}/g, fileBase)
    .replace(
      /\{index\}/g,
      String(index + 1).padStart(Math.max(1, indexPadWidth), '0'),
    )
    .replace(/\{date\}/g, getDateToken())
    .replace(/\{folder\}/g, activeFolderLabel || 'images')
    .trim();
  return sanitizeFileSegment(formatted || fileBase || `image_${index + 1}`);
};

const renderTruncatedMiddle = (text: string) => {
  if (!text) return null;
  const mid = Math.ceil(text.length / 2);
  return (
    <>
      <span className="truncate-start">{text.slice(0, mid)}</span>
      <span className="truncate-end">{text.slice(mid)}</span>
    </>
  );
};

interface TreeNode {
  name: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
  imageCount: number;
  captionCount: number;
  firstImageName: string | null;
  firstCaptionName: string | null;
}

const TreeSvgConnector = ({ isLast }: { isLast: boolean }) => (
  <svg
    className="export-plan-tree-svg-connector"
    xmlns="http://www.w3.org/2000/svg"
    height="100%"
  >
    {/* 
      1. Branch path:
         Drops from the exact bottom edge of the parent icon (Y=-8).
         Curves to reach exactly the vertical middle of the 30px row (Y=15).
         Stops at the exact left edge of the visible child icon (X=29).
    */}
    <path
      d="M 12 -8 L 12 7 A 8 8 0 0 0 20 15 L 29 15"
      stroke="currentColor"
      strokeWidth="1"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* 
      2. Vertical Spine:
         Draws a continuous solid line starting from Y=-8 (to seamlessly overlap)
         down to 100% height of this container, feeding directly into the NEXT sibling's Y=0.
    */}
    {!isLast && (
      <line
        x1="12"
        y1="-8"
        x2="12"
        y2="100%"
        stroke="currentColor"
        strokeWidth="1"
      />
    )}
  </svg>
);

const buildTree = (paths: string[]): TreeNode => {
  const root: TreeNode = {
    name: '',
    isDir: true,
    children: new Map(),
    imageCount: 0,
    captionCount: 0,
    firstImageName: null,
    firstCaptionName: null,
  };

  paths.forEach((path) => {
    const parts = path.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isLastPart = index === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          isDir: !isLastPart,
          children: new Map(),
          imageCount: 0,
          captionCount: 0,
          firstImageName: null,
          firstCaptionName: null,
        });
      }

      const nextNode = current.children.get(part)!;

      // If it's the file name part, track its stats on the parent folder
      if (isLastPart) {
        if (part.toLowerCase().endsWith('.txt')) {
          current.captionCount++;
          if (!current.firstCaptionName) current.firstCaptionName = part;
        } else {
          current.imageCount++;
          if (!current.firstImageName) current.firstImageName = part;
        }
      }

      current = nextNode;
    });
  });
  return root;
};

const TreeFolder = ({
  node,
  isLastItem = false,
}: {
  node: TreeNode;
  isLastItem?: boolean;
}) => {
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={`export-plan-tree-node ${isLastItem ? 'is-last' : ''}`}>
      <TreeSvgConnector isLast={isLastItem} />
      <div className="export-plan-tree-row">
        <span className="export-plan-tree-icon-wrapper">
          <FolderOpen size={14} className="export-plan-tree-folder-icon" />
        </span>
        <span className="export-plan-tree-name">
          {renderTruncatedMiddle(node.name)}
        </span>
      </div>
      <div className="export-plan-tree-children">
        {sortedChildren
          .filter((c) => c.isDir)
          .map((child, index) => {
            const isLast =
              index === sortedChildren.filter((c) => c.isDir).length - 1 &&
              node.imageCount === 0 &&
              node.captionCount === 0;
            return (
              <TreeFolder key={child.name} node={child} isLastItem={isLast} />
            );
          })}

        {node.firstImageName && (
          <div
            className={`export-plan-tree-row export-plan-tree-file ${node.captionCount === 0 ? 'is-last' : ''}`}
          >
            <TreeSvgConnector isLast={node.captionCount === 0} />
            <span className="export-plan-tree-icon-wrapper file-wrapper">
              <FileImage size={13} className="export-plan-tree-file-icon" />
            </span>
            <span className="export-plan-tree-name">
              {renderTruncatedMiddle(node.firstImageName)}
            </span>
            {node.imageCount > 1 && (
              <span className="export-plan-tree-summary-tag">
                + {node.imageCount - 1} images
              </span>
            )}
          </div>
        )}

        {node.firstCaptionName && (
          <div className="export-plan-tree-row export-plan-tree-file is-last">
            <TreeSvgConnector isLast={true} />
            <span className="export-plan-tree-icon-wrapper file-wrapper">
              <FileText size={13} className="export-plan-tree-file-icon" />
            </span>
            <span className="export-plan-tree-name">
              {renderTruncatedMiddle(node.firstCaptionName)}
            </span>
            {node.captionCount > 1 && (
              <span className="export-plan-tree-summary-tag">
                + {node.captionCount - 1} captions
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const OutputTreeDisplay = ({
  paths,
  baseName,
}: {
  paths: string[];
  baseName: string;
}) => {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const sortedRootChildren = Array.from(tree.children.values()).sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="export-plan-tree-wrapper">
      <div className="export-plan-tree-base-row">
        <span className="export-plan-tree-icon-wrapper">
          <HardDriveDownload size={15} style={{ color: 'var(--accent)' }} />
        </span>
        <span className="export-plan-tree-name root-name">
          {renderTruncatedMiddle(baseName)}
        </span>
      </div>
      <div className="export-plan-tree-children root-children">
        {sortedRootChildren
          .filter((c) => c.isDir)
          .map((child, index) => {
            const isLast =
              index === sortedRootChildren.filter((c) => c.isDir).length - 1 &&
              tree.imageCount === 0 &&
              tree.captionCount === 0;
            return (
              <TreeFolder key={child.name} node={child} isLastItem={isLast} />
            );
          })}

        {tree.firstImageName && (
          <div
            className={`export-plan-tree-row export-plan-tree-file ${tree.captionCount === 0 ? 'is-last' : ''}`}
          >
            <TreeSvgConnector isLast={tree.captionCount === 0} />
            <span className="export-plan-tree-icon-wrapper file-wrapper">
              <FileImage size={13} className="export-plan-tree-file-icon" />
            </span>
            <span className="export-plan-tree-name">
              {renderTruncatedMiddle(tree.firstImageName)}
            </span>
            {tree.imageCount > 1 && (
              <span className="export-plan-tree-summary-tag">
                + {tree.imageCount - 1} images
              </span>
            )}
          </div>
        )}

        {tree.firstCaptionName && (
          <div className="export-plan-tree-row export-plan-tree-file is-last">
            <TreeSvgConnector isLast={true} />
            <span className="export-plan-tree-icon-wrapper file-wrapper">
              <FileText size={13} className="export-plan-tree-file-icon" />
            </span>
            <span className="export-plan-tree-name">
              {renderTruncatedMiddle(tree.firstCaptionName)}
            </span>
            {tree.captionCount > 1 && (
              <span className="export-plan-tree-summary-tag">
                + {tree.captionCount - 1} captions
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ExportPlanModal = ({
  images,
  currentFolderImages,
  selectedFolderPaths,
  excludedById,
  resolveRootForFolderPath,
  folderNodes,
  selectedId,
  activeFolderLabel,
  activeFolderPathOnDisk = '',
  format,
  quality,
  cropData,
  captionById,
  onEnableFolderSelectionMode,
  onClose,
}: ExportPlanModalProps) => {
  const hasSelectedImage = useMemo(
    () => images.some((image) => image.id === selectedId),
    [images, selectedId],
  );

  const [scope, setScope] = useState<ExportScope>(() => {
    if (selectedFolderPaths.size > 0) return 'selected_folders';
    if (hasSelectedImage) return 'current_image';
    if (currentFolderImages.length > 0) return 'current_folder';
    return 'current_folder';
  });

  const [isScanning, setIsScanning] = useState(false);
  const [scannedSelectedImages, setScannedSelectedImages] = useState<
    GalleryImage[]
  >([]);

  const [destinationMode, setDestinationMode] =
    useState<DestinationMode>('folder');
  const [destinationName, setDestinationName] = useState(() => {
    const safeFolderLabel = sanitizeFileSegment(activeFolderLabel || 'Images');
    return `${safeFolderLabel}-Export-{date}`;
  });
  const [namePattern, setNamePattern] = useState('');
  const [structureMode, setStructureMode] = useState<StructureMode>('preserve');
  const [conflictMode, setConflictMode] = useState<ConflictMode>('auto_rename');
  const [exportEditedOnly, setExportEditedOnly] = useState(false);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [clearMetadata, setClearMetadata] = useState(false);
  const [exportFormat, setExportFormat] = useState<'original' | ExportFormat>(
    'original',
  );
  const [hasCustomBaseFolder, setHasCustomBaseFolder] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportMessage, setLastExportMessage] = useState<string | null>(
    null,
  );

  const folderNameByPath = useMemo(() => {
    const next = new Map<string, string>();
    folderNodes.forEach((folder) => {
      next.set(normalizePath(folder.path), folder.name);
    });
    return next;
  }, [folderNodes]);

  const selectedFolderPathList = useMemo(
    () =>
      Array.from(selectedFolderPaths)
        .map((path) => normalizePath(path))
        .filter(Boolean),
    [selectedFolderPaths],
  );

  const selectedFolderLabels = useMemo(() => {
    return selectedFolderPathList.map((path) => ({
      path,
      label:
        folderNameByPath.get(path) ||
        path.split('/').filter(Boolean).pop() ||
        path,
    }));
  }, [folderNameByPath, selectedFolderPathList]);

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedId) || null,
    [images, selectedId],
  );

  const selectedImageFolderPath = useMemo(
    () => getParentDirectory(selectedImage?.absolutePath || ''),
    [selectedImage],
  );

  const selectedFoldersRoot = useMemo(() => {
    const firstPath = selectedFolderPathList[0] || '';
    if (!firstPath) return '';
    const firstSegment = firstPath.split('/').filter(Boolean)[0] || '';
    return firstSegment || firstPath;
  }, [selectedFolderPathList]);

  useEffect(() => {
    if (scope !== 'selected_folders') return;
    if (selectedFolderPathList.length === 0) {
      setScannedSelectedImages([]);
      return;
    }

    let isCancelled = false;
    const fetchSelectedImages = async () => {
      setIsScanning(true);
      try {
        const allScanned: GalleryImage[] = [];
        const seenIds = new Set<string>();

        const scanPromises = selectedFolderPathList.map(async (folderPath) => {
          const resolved = resolveRootForFolderPath(folderPath);
          if (!resolved) return [];

          const result = await scanImagesFromFolderPath({
            rootPath: resolved.root.rootPath,
            rootName: resolved.root.rootName,
            folderPath,
            recursive: true,
          });

          return result.images;
        });

        const results = await Promise.all(scanPromises);
        if (isCancelled) return;

        results.forEach((folderImages: any[]) => {
          folderImages.forEach((image: any) => {
            if (!seenIds.has(image.id)) {
              seenIds.add(image.id);

              if (!excludedById.has(image.id)) {
                // We convert NativeScannedImage into a lightweight GalleryImage mock if necessary,
                // but scanImagesFromFolderPath returns GalleryImage[]
                allScanned.push(image as unknown as GalleryImage);
              }
            }
          });
        });

        if (!isCancelled) {
          setScannedSelectedImages(allScanned);
        }
      } catch (error) {
        console.error('Failed to scan selected folders for export:', error);
      } finally {
        if (!isCancelled) {
          setIsScanning(false);
        }
      }
    };

    void fetchSelectedImages();

    return () => {
      isCancelled = true;
    };
  }, [
    scope,
    excludedById,
    resolveRootForFolderPath,
    selectedFolderPathList,
  ]);

  const suggestedBaseFolder = useMemo(() => {
    if (scope === 'selected_folders')
      return selectedFoldersRoot || activeFolderPathOnDisk || '';
    if (scope === 'current_image')
      return selectedImageFolderPath || activeFolderPathOnDisk || '';
    return activeFolderPathOnDisk || selectedImageFolderPath || '';
  }, [
    scope,
    selectedFoldersRoot,
    activeFolderPathOnDisk,
    selectedImageFolderPath,
  ]);

  const [baseFolder, setBaseFolder] = useState(suggestedBaseFolder);

  useEffect(() => {
    if (hasCustomBaseFolder) return;
    setBaseFolder(suggestedBaseFolder);
  }, [hasCustomBaseFolder, suggestedBaseFolder]);

  useEffect(() => {
    if (scope !== 'current_image') return;
    if (hasSelectedImage) return;
    if (selectedFolderPathList.length > 0) {
      setScope('selected_folders');
      return;
    }
    if (currentFolderImages.length > 0) {
      setScope('current_folder');
      return;
    }
    setScope('current_folder');
  }, [
    scope,
    hasSelectedImage,
    currentFolderImages.length,
    selectedFolderPathList.length,
  ]);

  useEffect(() => {
    if (scope !== 'selected_folders') return;
    if (selectedFolderPathList.length > 0) return;
    if (hasSelectedImage) {
      setScope('current_image');
      return;
    }
    setScope('current_folder');
  }, [scope, selectedFolderPathList.length, hasSelectedImage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const scopeImages = useMemo(() => {
    if (scope === 'selected_folders') {
      return scannedSelectedImages.filter((image) => !excludedById.has(image.id));
    }
    if (scope === 'current_folder') {
      return currentFolderImages.filter((image) => !excludedById.has(image.id));
    }
    if (!selectedId) return [];
    const selectedImage = images.find((image) => image.id === selectedId);
    if (!selectedImage || excludedById.has(selectedImage.id)) return [];
    return [selectedImage];
  }, [
    currentFolderImages,
    excludedById,
    images,
    scope,
    scannedSelectedImages,
    selectedId,
  ]);

  const analyzedScope = useMemo(() => {
    return scopeImages.map((image) => {
      const cropEntry = cropData.get(image.id);
      const caption = String(captionById.get(image.id) || '');
      const isEdited = hasMeaningfulImageChange(
        image,
        cropEntry,
        caption,
        includeCaptions,
      );
      const outputWidth = Number(cropEntry?.outputWidth || 0);
      const hasResize = Number.isFinite(outputWidth) && outputWidth > 0;
      const dims = computeOutputDimensions(image, cropEntry);
      return {
        image,
        cropEntry,
        caption,
        isEdited,
        hasResize,
        dims,
      };
    });
  }, [captionById, cropData, scopeImages, includeCaptions]);

  const filteredExportSource = useMemo(
    () =>
      exportEditedOnly
        ? analyzedScope.filter((entry) => entry.isEdited)
        : analyzedScope,
    [analyzedScope, exportEditedOnly],
  );

  const resolvedFolderName = useMemo(() => {
    const resolvedTemplate = String(destinationName || '')
      .replace(/\{date\}/g, getDateToken())
      .replace(
        /\{folder\}/g,
        sanitizeFileSegment(activeFolderLabel || 'Images'),
      )
      .trim();
    return sanitizeFileSegment(resolvedTemplate || 'Export');
  }, [activeFolderLabel, destinationName]);

  const resolvedDestinationPath = useMemo(() => {
    const base = normalizePath(baseFolder || '');
    const folderSegment = resolvedFolderName;
    const folderPath = joinPath(base, folderSegment);
    if (destinationMode === 'zip') return `${folderPath}.zip`;
    return folderPath;
  }, [baseFolder, destinationMode, resolvedFolderName]);

  const outputRows = useMemo(() => {
    const trimmedPattern = String(namePattern || '').trim();
    const usePattern = trimmedPattern.length > 0;
    const rootSegments = new Set<string>();
    filteredExportSource.forEach((entry) => {
      const first = normalizePath(entry.image.relativePath)
        .split('/')
        .filter(Boolean)[0];
      if (first) rootSegments.add(first);
    });
    const preserveRootSegment =
      structureMode === 'preserve' &&
      scope === 'selected_folders' &&
      rootSegments.size > 1;

    const resolveRelativeParent = (image: GalleryImage): string => {
      if (structureMode === 'flatten') return '';

      if (structureMode === 'one_level' && scope === 'selected_folders') {
        const normalizedAbsolutePath = normalizePath(image.absolutePath || '');
        const normalizedRelativePath = normalizePath(image.relativePath);
        const normalizedAbsoluteParent = getParentDirectory(normalizedAbsolutePath);
        const normalizedRelativeParent = getParentDirectory(normalizedRelativePath);

        const matchedFolder =
          findLongestPrefixMatch(normalizedAbsolutePath, selectedFolderPathList) ||
          findLongestPrefixMatch(normalizedAbsoluteParent, selectedFolderPathList) ||
          findLongestPrefixMatch(normalizedRelativePath, selectedFolderPathList) ||
          findLongestPrefixMatch(normalizedRelativeParent, selectedFolderPathList);

        if (!matchedFolder) {
          return sanitizeRelativePath(
            getRelativeParentPath(image.relativePath, {
              includeRoot: preserveRootSegment,
            }),
          );
        }

        const topLevelName =
          sanitizeFileSegment(
            matchedFolder.split('/').filter(Boolean).pop() || '',
          ) || 'folder';

        let subPath = '';
        if (pathHasPrefix(normalizedAbsoluteParent, matchedFolder)) {
          subPath =
            normalizedAbsoluteParent === normalizePath(matchedFolder)
              ? ''
              : normalizedAbsoluteParent.slice(
                  normalizePath(matchedFolder).length + 1,
                );
        } else if (pathHasPrefix(normalizedRelativeParent, matchedFolder)) {
          subPath =
            normalizedRelativeParent === normalizePath(matchedFolder)
              ? ''
              : normalizedRelativeParent.slice(
                  normalizePath(matchedFolder).length + 1,
                );
        }

        return sanitizeRelativePath(joinPath(topLevelName, subPath));
      }

      if (structureMode === 'preserve') {
        return sanitizeRelativePath(
          getRelativeParentPath(image.relativePath, {
            includeRoot: preserveRootSegment,
          }),
        );
      }

      return '';
    };

    const totalsByParent = new Map<string, number>();
    filteredExportSource.forEach((entry) => {
      const relativeParent = resolveRelativeParent(entry.image);
      totalsByParent.set(relativeParent, (totalsByParent.get(relativeParent) || 0) + 1);
    });

    const seenByParent = new Map<string, number>();

    const nextRows: OutputRow[] = filteredExportSource.map((entry, index) => {
      const relativeParent = resolveRelativeParent(entry.image);

      const folderIndex = seenByParent.get(relativeParent) || 0;
      seenByParent.set(relativeParent, folderIndex + 1);
      const folderTotal = totalsByParent.get(relativeParent) || 1;
      const indexPadWidth = String(Math.max(1, folderTotal)).length;

      const fileBase = usePattern
        ? formatNamePattern(
            trimmedPattern,
            entry.image,
            folderIndex,
            indexPadWidth,
            sanitizeFileSegment(activeFolderLabel || 'images'),
          )
        : sanitizeFileSegment(getNameWithoutExtension(entry.image.name));

      const fileExt =
        exportFormat === 'original'
          ? entry.image.relativePath.split('.').pop()?.toLowerCase() || 'jpg'
          : toExtension(exportFormat);

      const fileName = `${fileBase || `image_${index + 1}`}.${fileExt}`;
      const outputPath = relativeParent
        ? joinPath(relativeParent, fileName)
        : fileName;

      return {
        imageId: entry.image.id,
        sourceName: entry.image.name,
        sourcePath: normalizePath(entry.image.relativePath),
        outputPath,
        outputWidth: entry.dims.width,
        outputHeight: entry.dims.height,
        isEdited: entry.isEdited,
        hasCaption: includeCaptions && entry.caption.trim().length > 0,
        skipped: false,
        collision: false,
      };
    });

    const byPathCount = new Map<string, number>();
    nextRows.forEach((row) => {
      byPathCount.set(
        row.outputPath,
        (byPathCount.get(row.outputPath) || 0) + 1,
      );
    });

    const seenByPath = new Map<string, number>();
    return nextRows.map((row) => {
      const totalWithPath = byPathCount.get(row.outputPath) || 0;
      const nextSeen = (seenByPath.get(row.outputPath) || 0) + 1;
      seenByPath.set(row.outputPath, nextSeen);
      const hasCollision = totalWithPath > 1;

      if (!hasCollision) {
        return row;
      }

      if (conflictMode === 'auto_rename') {
        return {
          ...row,
          outputPath: addConflictSuffix(row.outputPath, nextSeen),
          collision: false,
        };
      }

      if (conflictMode === 'skip') {
        return {
          ...row,
          skipped: nextSeen > 1,
          collision: true,
        };
      }

      return {
        ...row,
        collision: true,
      };
    });
  }, [
    activeFolderLabel,
    conflictMode,
    filteredExportSource,
    exportFormat,
    namePattern,
    scope,
    selectedFolderPathList,
    structureMode,
    includeCaptions,
  ]);
  
  const resizeCount = useMemo(
    () => analyzedScope.filter((entry) => entry.hasResize).length,
    [analyzedScope],
  );
  const mixedResize = useMemo(() => {
    const widths = new Set(
      analyzedScope
        .map((entry) => Number(entry.cropEntry?.outputWidth || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    return widths.size > 1;
  }, [analyzedScope]);

  const collisionCount = useMemo(
    () => outputRows.filter((row) => row.collision).length,
    [outputRows],
  );
  const skippedCount = useMemo(
    () => outputRows.filter((row) => row.skipped).length,
    [outputRows],
  );

  const totalPlannedCaptions = useMemo(
    () => outputRows.filter((row) => row.hasCaption).length,
    [outputRows],
  );

  const totalBaseCount = outputRows.length + totalPlannedCaptions;
  const totalSkippedCount = skippedCount; // Captions are only skipped if the image is skipped?
  const finalWriteCount = totalBaseCount - totalSkippedCount;

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (scope === 'selected_folders' && selectedFolderPathList.length === 0) {
      errors.push('Pick at least one folder in Explorer select mode.');
    }
    if (scopeImages.length === 0) {
      errors.push(
        scope === 'selected_folders'
          ? 'Selected folders currently have no loaded direct images.'
          : 'No images are available for the selected export scope.',
      );
    }
    if (!String(baseFolder || '').trim()) {
      errors.push('Choose a base destination folder before exporting.');
    }
    if (filteredExportSource.length === 0) {
      errors.push(
        exportEditedOnly
          ? 'No edited images found in this scope.'
          : 'No images would be exported with current settings.',
      );
    }
    return errors;
  }, [
    baseFolder,
    collisionCount,
    conflictMode,
    exportEditedOnly,
    filteredExportSource.length,
    namePattern,
    scope,
    scopeImages.length,
    selectedFolderPathList.length,
  ]);

  const warningMessages = useMemo(() => {
    const warnings: string[] = [];
    if (collisionCount > 0 && conflictMode === 'skip') {
      warnings.push(
        `${collisionCount} collisions detected. ${skippedCount} file(s) will be skipped in this plan.`,
      );
    }
    if (mixedResize) {
      warnings.push('Resize settings are mixed across images in this scope.');
    }
    if (exportEditedOnly) {
      warnings.push('Only edited images are included in this export scope.');
    }
    return warnings;
  }, [
    collisionCount,
    conflictMode,
    exportEditedOnly,
    mixedResize,
    skippedCount,
  ]);

  const analyzedById = useMemo(() => {
    const next = new Map<
      string,
      (typeof analyzedScope)[number]
    >();
    analyzedScope.forEach((entry) => {
      next.set(entry.image.id, entry);
    });
    return next;
  }, [analyzedScope]);

  const handleStartExport = useCallback(async () => {
    if (isExporting) return;
    if (validationErrors.length > 0) return;

    setExportError(null);
    setLastExportMessage(null);

    if (!isTauriRuntime()) {
      setExportError('Export is currently only available in the desktop app.');
      return;
    }

    const paddingImageAssets = new Map<string, string>();
    const payloadItems: ExecuteExportPlanItemPayload[] = [];

    setIsExporting(true);
    try {
      for (const row of outputRows) {
        const analyzed = analyzedById.get(row.imageId);
        if (!analyzed) continue;

        const sourcePath = normalizePath(analyzed.image.absolutePath || '');
        let sourceDataBase64: string | undefined;
        if (!sourcePath) {
          const fileSize = Number(analyzed.image.file?.size || 0);
          if (fileSize > 0) {
            sourceDataBase64 = await blobToBase64(analyzed.image.file);
          }
        }

        if (!sourcePath && !sourceDataBase64) {
          throw new Error(
            `Image "${analyzed.image.name}" has no readable source path.`,
          );
        }

        const cropEntry = analyzed.cropEntry ? { ...analyzed.cropEntry } : null;
        const paddingImageUrl =
          typeof cropEntry?.paddingImageUrl === 'string'
            ? cropEntry.paddingImageUrl.trim()
            : '';
        if (paddingImageUrl && !paddingImageAssets.has(paddingImageUrl)) {
          const response = await fetch(paddingImageUrl);
          if (!response.ok) {
            throw new Error(
              `Failed to read padding image asset (${response.status}).`,
            );
          }
          const assetBlob = await response.blob();
          paddingImageAssets.set(
            paddingImageUrl,
            await blobToBase64(assetBlob),
          );
        }

        payloadItems.push({
          imageId: row.imageId,
          sourcePath,
          sourceName: analyzed.image.name,
          sourceDataBase64,
          outputPath: row.outputPath,
          caption: includeCaptions ? analyzed.caption : '',
          crop: cropEntry,
          skip: row.skipped,
        });
      }

      const request: ExecuteExportPlanRequestPayload = {
        destinationMode,
        baseFolder,
        destinationName: resolvedFolderName,
        conflictMode,
        quality: Math.max(1, Math.min(100, Math.round(Number(quality) || 90))),
        clearMetadata,
        includeCaptions,
        items: payloadItems,
        paddingImageAssets: Object.fromEntries(paddingImageAssets),
      };

      const result = await invoke<ExecuteExportPlanResultPayload>(
        'execute_export_plan',
        { request },
      );

      const summary = `Export complete: ${result.writtenCount} files, ${result.captionWrittenCount} captions -> ${result.destinationPath}`;
      const firstWarning = result.warnings[0];
      setLastExportMessage(
        firstWarning && result.failedCount === 0
          ? `${summary} (${firstWarning})`
          : summary,
      );
      if (result.failedCount > 0) {
        const warning = firstWarning || 'Some files failed to export.';
        setExportError(
          `${warning} (${result.failedCount} failure${result.failedCount === 1 ? '' : 's'})`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to export files.';
      setExportError(message);
      console.error('Export plan execution failed:', error);
    } finally {
      setIsExporting(false);
    }
  }, [
    analyzedById,
    baseFolder,
    clearMetadata,
    conflictMode,
    destinationMode,
    includeCaptions,
    isExporting,
    outputRows,
    quality,
    resolvedFolderName,
    validationErrors.length,
  ]);

  const statusTone = validationErrors.length || exportError
    ? 'blocked'
    : isExporting || warningMessages.length
      ? 'warning'
      : 'ready';

  return (
    <div
      className="export-plan-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        layout
        className="export-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export plan"
      >
        <header className="export-plan-header">
          <div>
            <h2>Export Plan</h2>
            <p>Review exactly what will be generated before output starts.</p>
          </div>
          <button
            type="button"
            className="btn-icon export-plan-close"
            onClick={onClose}
            aria-label="Close export plan"
          >
            <X size={16} />
          </button>
        </header>

        <div className="export-plan-body">
          <div className="export-plan-config-grid">
            {/* LEFT GRID COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section className="export-plan-card">
                <label className="export-plan-field">
                  <span>What to Export/Save</span>
                  <SegmentedControl<ExportScope>
                    value={scope}
                    onChange={setScope}
                    ariaLabel="Export scope"
                    className="export-plan-segmented-control"
                    equalWidth
                    options={[
                      {
                        value: 'current_image',
                        label: 'Current Image',
                        disabled: !hasSelectedImage,
                        title: !hasSelectedImage
                          ? 'Select an image first'
                          : undefined,
                      },
                      { value: 'current_folder', label: 'Current Folder' },
                      {
                        value: 'selected_folders',
                        label: 'Selected Folders',
                        disabled: selectedFolderPathList.length === 0,
                        title:
                          selectedFolderPathList.length === 0
                            ? 'No selected folders yet'
                            : undefined,
                      },
                    ]}
                  />
                </label>

                <label className="export-plan-field">
                  <span>Save as</span>
                  <SegmentedControl<DestinationMode>
                    value={destinationMode}
                    onChange={setDestinationMode}
                    ariaLabel="Destination mode"
                    className="export-plan-segmented-control"
                    equalWidth
                    options={[
                      {
                        value: 'folder',
                        label: (
                          <>
                            <FolderOpen size={14} />
                            Folder
                          </>
                        ),
                      },
                      {
                        value: 'zip',
                        label: (
                          <>
                            <Archive size={14} />
                            ZIP
                          </>
                        ),
                      },
                    ]}
                  />
                </label>

                <label className="export-plan-field">
                  <span>Base Folder</span>
                  <input
                    className="input"
                    value={baseFolder}
                    onChange={(event) => {
                      setHasCustomBaseFolder(true);
                      setBaseFolder(event.target.value);
                    }}
                    placeholder="/path/to/destination"
                    type="text"
                  />
                </label>

                <div className="export-plan-quick-bases">
                  <button
                    type="button"
                    className="export-plan-quick-base"
                    onClick={() => {
                      setHasCustomBaseFolder(true);
                      setBaseFolder('~/Downloads');
                    }}
                  >
                    <HardDriveDownload size={12} />
                    Downloads
                  </button>
                  <button
                    type="button"
                    className="export-plan-quick-base"
                    onClick={() => {
                      setHasCustomBaseFolder(true);
                      setBaseFolder('~/Pictures');
                    }}
                  >
                    <ImageIcon size={12} />
                    Pictures
                  </button>
                  {activeFolderPathOnDisk && (
                    <button
                      type="button"
                      className="export-plan-quick-base"
                      onClick={() => {
                        setHasCustomBaseFolder(true);
                        setBaseFolder(activeFolderPathOnDisk);
                      }}
                    >
                      <FolderOpen size={12} />
                      Current Folder
                    </button>
                  )}
                  {selectedImageFolderPath && (
                    <button
                      type="button"
                      className="export-plan-quick-base"
                      onClick={() => {
                        setHasCustomBaseFolder(true);
                        setBaseFolder(selectedImageFolderPath);
                      }}
                    >
                      <ImageIcon size={12} />
                      Image Folder
                    </button>
                  )}
                </div>

                <label className="export-plan-field">
                  <span>
                    Output Name
                    <div className="export-plan-token-list">
                      <span className="export-plan-token">{`{date}`}</span>
                      <span className="export-plan-token">{`{folder}`}</span>
                    </div>
                  </span>
                  <input
                    className="input"
                    value={destinationName}
                    onChange={(event) => setDestinationName(event.target.value)}
                    placeholder="{folder}-Export-{date}"
                    type="text"
                  />
                </label>

                <label className="export-plan-field">
                  <span>
                    Name Pattern
                    <div className="export-plan-token-list">
                      <span className="export-plan-token">{`{name}`}</span>
                      <span className="export-plan-token">{`{index}`}</span>
                      <span className="export-plan-token">{`{date}`}</span>
                      <span className="export-plan-token">{`{folder}`}</span>
                    </div>
                  </span>
                  <input
                    className="input"
                    value={namePattern}
                    onChange={(event) => setNamePattern(event.target.value)}
                    placeholder="Leave empty for Auto-rename (keep original names)"
                    type="text"
                  />
                </label>

                <label className="export-plan-field" style={{ marginTop: 12 }}>
                  <span>Format Conversion</span>
                  <SegmentedControl<'original' | ExportFormat>
                    value={exportFormat}
                    onChange={setExportFormat}
                    ariaLabel="Export format"
                    className="export-plan-segmented-control"
                    equalWidth
                    options={[
                      { value: 'original', label: 'Original' },
                      { value: 'png', label: 'PNG' },
                      { value: 'jpeg', label: 'JPEG' },
                      { value: 'webp', label: 'WEBP' },
                    ]}
                  />
                </label>

                <label className="export-plan-field" style={{ marginTop: 12 }}>
                  <span>If file exists:</span>
                  <SegmentedControl<ConflictMode>
                    value={conflictMode}
                    onChange={setConflictMode}
                    ariaLabel="Conflict mode"
                    className="export-plan-segmented-control"
                    equalWidth
                    options={[
                      { value: 'auto_rename', label: 'Auto-Rename' },
                      { value: 'skip', label: 'Skip' },
                      {
                        value: 'overwrite',
                        label: 'Overwrite',
                        tone: 'danger',
                      },
                    ]}
                  />
                </label>
              </section>
            </div>

            {/* RIGHT GRID COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section className="export-plan-card export-plan-card-summary">
                <h3>Output Summary</h3>

                <label
                  className="export-plan-inline-checkbox export-plan-inline-checkbox--control"
                  style={{ marginTop: 12 }}
                >
                  <TriStateCheckbox
                    state={exportEditedOnly ? 'checked' : 'unchecked'}
                    onToggle={setExportEditedOnly}
                    ariaLabel="Export only edited images"
                  />
                  Export only edited images
                </label>

                <label
                  className="export-plan-inline-checkbox export-plan-inline-checkbox--control"
                  style={{ marginTop: 8 }}
                >
                  <TriStateCheckbox
                    state={clearMetadata ? 'checked' : 'unchecked'}
                    onToggle={setClearMetadata}
                    ariaLabel="Clear EXIF and other metadata from images"
                  />
                  Clear EXIF and hidden metadata
                </label>

                <label
                  className="export-plan-inline-checkbox export-plan-inline-checkbox--control"
                  style={{ marginTop: 8 }}
                >
                  <TriStateCheckbox
                    state={includeCaptions ? 'checked' : 'unchecked'}
                    onToggle={setIncludeCaptions}
                    ariaLabel="Include sidecar .txt files for image captions"
                  />
                  Include sidecar captions (.txt)
                </label>

                <div className="export-plan-path-preview">
                  <span>Resolved Destination Base</span>
                  <code>
                    {resolvedDestinationPath || 'Select destination folder'}
                  </code>
                </div>

                <label className="export-plan-field" style={{ marginTop: 12 }}>
                  <span>Folder Structure</span>
                  <SegmentedControl<StructureMode>
                    value={structureMode}
                    onChange={setStructureMode}
                    ariaLabel="Folder structure mode"
                    className="export-plan-segmented-control"
                    equalWidth
                    options={[
                      { value: 'preserve', label: 'Preserve Original' },
                      { value: 'one_level', label: 'One Level' },
                      { value: 'flatten', label: 'Flatten to Root' },
                    ]}
                  />
                </label>

                {resizeCount > 0 && (
                  <div className="export-plan-preflight-meta">
                    <span className="export-plan-preflight-meta-item">
                      <strong>{resizeCount}</strong> resized
                    </span>
                  </div>
                )}

                {mixedResize && (
                  <div
                    style={{
                      padding: '0 4px',
                      marginBottom: 8,
                      fontSize: '0.68rem',
                      color: '#ffebb1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Sparkles size={13} style={{ color: '#fbbf24' }} />
                    Mixed resizes detected
                  </div>
                )}

                <div className="export-plan-tree-section">
                  <OutputTreeDisplay
                    paths={outputRows.flatMap((r) => {
                      const paths = [r.outputPath];
                      if (r.hasCaption) {
                        // Generate the .txt sidecar path by replacing the extension
                        const txtPath =
                          r.outputPath.replace(/\.[^/.]+$/, '') + '.txt';
                        paths.push(txtPath);
                      }
                      return paths;
                    })}
                    baseName={resolvedFolderName || 'Export'}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>

        <footer className="export-plan-footer">
          <div
            className={`export-plan-status export-plan-status--${statusTone}`}
          >
            {statusTone === 'ready' ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <div>
              {exportError ? (
                <p>{exportError}</p>
              ) : lastExportMessage ? (
                <p>{lastExportMessage}</p>
              ) : validationErrors.length > 0 ? (
                <p>{validationErrors[0]}</p>
              ) : warningMessages.length > 0 ? (
                <p>{warningMessages[0]}</p>
              ) : (
                <p>Preflight checks look good.</p>
              )}
              <small>
                Planned writes: {finalWriteCount} / {totalBaseCount}
                {totalSkippedCount > 0 ? `, skipped: ${totalSkippedCount}` : ''}
              </small>
            </div>
          </div>
          <div className="export-plan-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isExporting}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void handleStartExport();
              }}
              disabled={validationErrors.length > 0 || isExporting}
              title={
                validationErrors.length > 0
                  ? validationErrors[0]
                  : isExporting
                    ? 'Export in progress...'
                    : 'Start export'
              }
            >
              {isExporting ? (
                <>
                  <Loader2 size={14} className="spin" />
                  Exporting...
                </>
              ) : (
                'Start Export'
              )}
            </button>
          </div>
        </footer>
      </motion.section>
    </div>
  );
};

export default React.memo(ExportPlanModal);
