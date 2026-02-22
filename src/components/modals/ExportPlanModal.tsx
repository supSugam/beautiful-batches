import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FolderOpen,
  FolderTree,
  HardDriveDownload,
  Image as ImageIcon,
  FileText,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  CropEntry,
  ExportFormat,
  FolderNode,
  GalleryImage,
} from '../../types/app';
import SegmentedControl from '../common/SegmentedControl';
import TriStateCheckbox from '../common/TriStateCheckbox';
import './ExportPlanModal.css';

type ExportScope = 'current_image' | 'current_folder' | 'selected_folders';
type DestinationMode = 'folder' | 'zip';
type NamingMode = 'keep_original' | 'pattern';
type ConflictMode = 'auto_rename' | 'skip' | 'overwrite';

type OutputRow = {
  imageId: string;
  sourceName: string;
  sourcePath: string;
  outputPath: string;
  outputWidth: number;
  outputHeight: number;
  isEdited: boolean;
  clearsMetadata: boolean;
  hasCaption: boolean;
  skipped: boolean;
  collision: boolean;
};

type ExportPlanModalProps = {
  images: GalleryImage[];
  currentFolderImages: GalleryImage[];
  selectedFolderImages: GalleryImage[];
  selectedFolderPaths: Set<string>;
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

const normalizePath = (value: string): string => String(value || '').replace(/\\/g, '/');

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
  if (format === 'jpeg') return 'jpg';
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

const getRelativeParentPath = (relativePath: string): string => {
  const parts = normalizePath(relativePath).split('/').filter(Boolean);
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
): boolean => {
  if (caption.trim().length > 0) return true;
  if (!entry) return false;

  const rotate = Number(entry.transforms?.rotate || 0);
  const flipH = Boolean(entry.transforms?.flip?.horizontal);
  const flipV = Boolean(entry.transforms?.flip?.vertical);
  const outputWidth = Number(entry.outputWidth || 0);
  const aspect = entry.aspect;
  const clearMetadata = Boolean(entry.clearImageMetadata);
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
  if (clearMetadata) return true;
  if (hasAnyPadding(entry) || hasAnyCornerRadius(entry)) return true;
  if (Math.abs(zoom - 1) > 0.0001) return true;
  if (Math.abs(anchorX - 0.5) > 0.0001 || Math.abs(anchorY - 0.5) > 0.0001) return true;
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
  activeFolderLabel: string,
): string => {
  const fileBase = getNameWithoutExtension(image.name);
  const formatted = String(pattern || '')
    .replace(/\{name\}/g, fileBase)
    .replace(/\{index\}/g, String(index + 1).padStart(3, '0'))
    .replace(/\{date\}/g, getDateToken())
    .replace(/\{folder\}/g, activeFolderLabel || 'images')
    .trim();
  return sanitizeFileSegment(formatted || fileBase || `image_${index + 1}`);
};

const ExportPlanModal = ({
  images,
  currentFolderImages,
  selectedFolderImages,
  selectedFolderPaths,
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
    if (hasSelectedImage) return 'current_image';
    if (currentFolderImages.length > 0) return 'current_folder';
    if (selectedFolderPaths.size > 0) return 'selected_folders';
    return 'current_folder';
  });
  const [destinationMode, setDestinationMode] = useState<DestinationMode>('folder');
  const [destinationName, setDestinationName] = useState(() => {
    const safeFolderLabel = sanitizeFileSegment(activeFolderLabel || 'Images');
    return `${safeFolderLabel}_Export_{date}`;
  });
  const [namingMode, setNamingMode] = useState<NamingMode>('keep_original');
  const [namePattern, setNamePattern] = useState('{name}_{index}');
  const [preserveTree, setPreserveTree] = useState(true);
  const [conflictMode, setConflictMode] = useState<ConflictMode>('auto_rename');
  const [exportEditedOnly, setExportEditedOnly] = useState(false);
  const [overwriteAcknowledge, setOverwriteAcknowledge] = useState(false);
  const [overwriteTypedConfirm, setOverwriteTypedConfirm] = useState('');
  const [hasCustomBaseFolder, setHasCustomBaseFolder] = useState(false);

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
      label: folderNameByPath.get(path) || path.split('/').filter(Boolean).pop() || path,
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

  const suggestedBaseFolder = useMemo(() => {
    if (scope === 'selected_folders') return selectedFoldersRoot || activeFolderPathOnDisk || '';
    if (scope === 'current_image') return selectedImageFolderPath || activeFolderPathOnDisk || '';
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
    if (currentFolderImages.length > 0) {
      setScope('current_folder');
      return;
    }
    if (selectedFolderPathList.length > 0) {
      setScope('selected_folders');
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
    if (scope === 'selected_folders') return selectedFolderImages;
    if (scope === 'current_folder') return currentFolderImages;
    if (!selectedId) return [];
    const selectedImage = images.find((image) => image.id === selectedId);
    return selectedImage ? [selectedImage] : [];
  }, [currentFolderImages, images, scope, selectedFolderImages, selectedId]);

  const analyzedScope = useMemo(() => {
    return scopeImages.map((image) => {
      const cropEntry = cropData.get(image.id);
      const caption = String(captionById.get(image.id) || '');
      const isEdited = hasMeaningfulImageChange(image, cropEntry, caption);
      const clearsMetadata = Boolean(cropEntry?.clearImageMetadata);
      const outputWidth = Number(cropEntry?.outputWidth || 0);
      const hasResize = Number.isFinite(outputWidth) && outputWidth > 0;
      const dims = computeOutputDimensions(image, cropEntry);
      return {
        image,
        cropEntry,
        caption,
        isEdited,
        clearsMetadata,
        hasResize,
        dims,
      };
    });
  }, [captionById, cropData, scopeImages]);

  const filteredExportSource = useMemo(
    () =>
      exportEditedOnly
        ? analyzedScope.filter((entry) => entry.isEdited)
        : analyzedScope,
    [analyzedScope, exportEditedOnly],
  );

  const filenameExtension = useMemo(() => toExtension(format), [format]);

  const resolvedFolderName = useMemo(() => {
    const resolvedTemplate = String(destinationName || '')
      .replace(/\{date\}/g, getDateToken())
      .replace(/\{folder\}/g, sanitizeFileSegment(activeFolderLabel || 'Images'))
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
    const nextRows: OutputRow[] = filteredExportSource.map((entry, index) => {
      const fileBase =
        namingMode === 'pattern'
          ? formatNamePattern(
              namePattern,
              entry.image,
              index,
              sanitizeFileSegment(activeFolderLabel || 'images'),
            )
          : sanitizeFileSegment(getNameWithoutExtension(entry.image.name));

      const fileName = `${fileBase || `image_${index + 1}`}.${filenameExtension}`;
      const relativeParent = preserveTree
        ? sanitizeRelativePath(getRelativeParentPath(entry.image.relativePath))
        : '';
      const outputPath = relativeParent ? joinPath(relativeParent, fileName) : fileName;

      return {
        imageId: entry.image.id,
        sourceName: entry.image.name,
        sourcePath: normalizePath(entry.image.relativePath),
        outputPath,
        outputWidth: entry.dims.width,
        outputHeight: entry.dims.height,
        isEdited: entry.isEdited,
        clearsMetadata: entry.clearsMetadata,
        hasCaption: entry.caption.trim().length > 0,
        skipped: false,
        collision: false,
      };
    });

    const byPathCount = new Map<string, number>();
    nextRows.forEach((row) => {
      byPathCount.set(row.outputPath, (byPathCount.get(row.outputPath) || 0) + 1);
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
    filenameExtension,
    namePattern,
    namingMode,
    preserveTree,
  ]);

  const previewRows = useMemo(
    () => outputRows.slice(0, OUTPUT_PREVIEW_LIMIT),
    [outputRows],
  );

  const resizeCount = useMemo(
    () => analyzedScope.filter((entry) => entry.hasResize).length,
    [analyzedScope],
  );
  const metadataClearCount = useMemo(
    () => analyzedScope.filter((entry) => entry.clearsMetadata).length,
    [analyzedScope],
  );
  const captionCount = useMemo(
    () => analyzedScope.filter((entry) => entry.caption.trim().length > 0).length,
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
  const finalWriteCount = outputRows.length - skippedCount;

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
    if (namingMode === 'pattern' && !String(namePattern || '').trim()) {
      errors.push('File naming pattern cannot be empty.');
    }
    if (filteredExportSource.length === 0) {
      errors.push(
        exportEditedOnly
          ? 'No edited images found in this scope.'
          : 'No images would be exported with current settings.',
      );
    }
    if (
      conflictMode === 'overwrite' &&
      collisionCount > 0 &&
      (!overwriteAcknowledge || overwriteTypedConfirm.trim() !== 'OVERWRITE')
    ) {
      errors.push('Overwrite confirmation is incomplete.');
    }
    return errors;
  }, [
    baseFolder,
    collisionCount,
    conflictMode,
    exportEditedOnly,
    filteredExportSource.length,
    namePattern,
    namingMode,
    overwriteAcknowledge,
    overwriteTypedConfirm,
    scope,
    scopeImages.length,
    selectedFolderPathList.length,
  ]);

  const warningMessages = useMemo(() => {
    const warnings: string[] = [];
    if (collisionCount > 0 && conflictMode === 'overwrite') {
      warnings.push(
        `${collisionCount} output path collisions detected. Existing files may be replaced.`,
      );
    } else if (collisionCount > 0 && conflictMode === 'skip') {
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
  }, [collisionCount, conflictMode, exportEditedOnly, mixedResize, skippedCount]);

  const statusTone = validationErrors.length
    ? 'blocked'
    : warningMessages.length
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
      <section
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
          <section className="export-plan-card">
            <h3>Scope</h3>
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
                  title: !hasSelectedImage ? 'Select an image first' : undefined,
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

            <div className="export-plan-pills">
              <span className="export-plan-pill">
                <strong>{scopeImages.length}</strong> source
              </span>
              <span className="export-plan-pill">
                <strong>{finalWriteCount}</strong> planned
              </span>
            </div>

            <label className="export-plan-inline-checkbox export-plan-inline-checkbox--control">
              <TriStateCheckbox
                state={exportEditedOnly ? 'checked' : 'unchecked'}
                onToggle={setExportEditedOnly}
                ariaLabel="Export only edited images"
              />
              Export only edited images
            </label>

            <AnimatePresence initial={false}>
              {scope === 'selected_folders' && (
                <motion.div
                  className="export-plan-selected-folders-box"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                >
                  <div className="export-plan-selected-folders-head">
                    <span>
                      <FolderTree size={13} />
                      Folder Picks
                    </span>
                    <span className="export-plan-selected-count">
                      {selectedFolderPathList.length}
                    </span>
                  </div>
                  {selectedFolderLabels.length > 0 ? (
                    <div className="export-plan-folder-chip-wrap">
                      {selectedFolderLabels.slice(0, 5).map((folder) => (
                        <span key={folder.path} className="export-plan-folder-chip">
                          {folder.label}
                        </span>
                      ))}
                      {selectedFolderLabels.length > 5 && (
                        <span className="export-plan-folder-chip">
                          +{selectedFolderLabels.length - 5} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="export-plan-muted">
                      No folders selected yet. Use Explorer select mode.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onEnableFolderSelectionMode?.()}
                    disabled={!onEnableFolderSelectionMode}
                  >
                    Select Folders In Explorer
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

          </section>

          <section className="export-plan-card">
            <h3>Destination</h3>
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
              <span>Output Name ({`{date} {folder}`})</span>
              <input
                className="input"
                value={destinationName}
                onChange={(event) => setDestinationName(event.target.value)}
                placeholder="{folder}_Export_{date}"
              />
            </label>

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

            <div className="export-plan-path-preview">
              <span>Resolved destination</span>
              <code>{resolvedDestinationPath || 'Select destination folder'}</code>
            </div>
          </section>

          <section className="export-plan-card">
            <h3>Naming + Conflicts</h3>
            <SegmentedControl<NamingMode>
              value={namingMode}
              onChange={setNamingMode}
              ariaLabel="Naming mode"
              className="export-plan-segmented-control"
              equalWidth
              options={[
                { value: 'keep_original', label: 'Keep Original Names' },
                { value: 'pattern', label: 'Pattern' },
              ]}
            />

            <AnimatePresence mode="wait" initial={false}>
              {namingMode === 'pattern' && (
                <motion.div
                  key="naming-pattern-field"
                  initial={{ opacity: 0, height: 0, y: -6 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -6 }}
                  transition={REVEAL_SECTION_TRANSITION}
                  style={{ overflow: 'hidden' }}
                >
                  <label className="export-plan-field">
                    <span>Pattern Tokens: {`{name} {index} {date} {folder}`}</span>
                    <input
                      className="input"
                      value={namePattern}
                      onChange={(event) => setNamePattern(event.target.value)}
                    />
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            <label className="export-plan-inline-checkbox export-plan-inline-checkbox--control">
              <TriStateCheckbox
                state={preserveTree ? 'checked' : 'unchecked'}
                onToggle={setPreserveTree}
                ariaLabel="Preserve folder structure inside export"
              />
              Preserve folder structure inside export
            </label>

            <SegmentedControl<ConflictMode>
              value={conflictMode}
              onChange={setConflictMode}
              ariaLabel="Conflict mode"
              className="export-plan-segmented-control"
              equalWidth
              options={[
                { value: 'auto_rename', label: 'Auto-Rename' },
                { value: 'skip', label: 'Skip' },
                { value: 'overwrite', label: 'Overwrite', tone: 'danger' },
              ]}
            />

            <AnimatePresence mode="wait" initial={false}>
              {conflictMode === 'overwrite' && collisionCount > 0 && (
                <motion.div
                  key="overwrite-safety-check"
                  className="export-plan-danger-box"
                  initial={{ opacity: 0, height: 0, y: -6 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -6 }}
                  transition={REVEAL_SECTION_TRANSITION}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="export-plan-danger-title">
                    <ShieldAlert size={15} />
                    <span>Overwrite Safety Check</span>
                  </div>
                  <label className="export-plan-inline-checkbox">
                    <TriStateCheckbox
                      state={overwriteAcknowledge ? 'checked' : 'unchecked'}
                      onToggle={setOverwriteAcknowledge}
                      ariaLabel="I understand files with matching paths can be replaced"
                    />
                    I understand files with matching paths can be replaced.
                  </label>
                  <label className="export-plan-field">
                    <span>Type OVERWRITE to continue</span>
                    <input
                      className="input"
                      value={overwriteTypedConfirm}
                      onChange={(event) => setOverwriteTypedConfirm(event.target.value)}
                      placeholder="OVERWRITE"
                    />
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <section className="export-plan-card export-plan-card-table">
            <div className="export-plan-table-headline">
              <h3>Preflight Preview</h3>
              <span>
                Showing {Math.min(previewRows.length, OUTPUT_PREVIEW_LIMIT)} of {outputRows.length}
              </span>
            </div>
            <div className="export-plan-pills export-plan-pills--inline export-plan-preflight-meta">
              <span className="export-plan-pill">
                <FileText size={12} /> {format.toUpperCase()}
              </span>
              <span className="export-plan-pill">Quality {quality}%</span>
              <span className="export-plan-pill">{resizeCount} resized</span>
              <span className="export-plan-pill">
                {metadataClearCount} metadata-clear
              </span>
              <span className="export-plan-pill">{captionCount} captions</span>
              {mixedResize && (
                <span className="export-plan-pill warning">
                  <Sparkles size={12} />
                  mixed resize
                </span>
              )}
            </div>
            <div className="export-plan-table-wrap">
              <table className="export-plan-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Output</th>
                    <th>Dims</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={`${row.imageId}:${row.outputPath}`}>
                      <td>
                        <div className="export-plan-cell-main">{row.sourceName}</div>
                        <div className="export-plan-cell-sub">{row.sourcePath}</div>
                      </td>
                      <td>
                        <div className="export-plan-cell-main">{row.outputPath}</div>
                        {row.skipped && (
                          <div className="export-plan-cell-sub warning">Skipped (duplicate)</div>
                        )}
                      </td>
                      <td>
                        {row.outputWidth} x {row.outputHeight}
                      </td>
                      <td>
                        <div className="export-plan-flag-list">
                          {row.isEdited && <span className="tag">edited</span>}
                          {row.clearsMetadata && <span className="tag">metadata-clear</span>}
                          {row.hasCaption && <span className="tag">caption</span>}
                          {row.collision && <span className="tag warning">collision</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {previewRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="export-plan-empty-row">
                        No files to preview with current settings.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className="export-plan-footer">
          <div className={`export-plan-status export-plan-status--${statusTone}`}>
            {statusTone === 'ready' ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <div>
              {validationErrors.length > 0 ? (
                <p>{validationErrors[0]}</p>
              ) : warningMessages.length > 0 ? (
                <p>{warningMessages[0]}</p>
              ) : (
                <p>Preflight checks look good.</p>
              )}
              <small>
                Planned writes: {finalWriteCount} / {outputRows.length}
                {skippedCount > 0 ? `, skipped: ${skippedCount}` : ''}
              </small>
            </div>
          </div>
          <div className="export-plan-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="Export functionality is not wired yet."
            >
              Start Export (Coming Soon)
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default React.memo(ExportPlanModal);
