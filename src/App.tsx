import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ACCEPTED_IMAGE_TYPES,
  clearSavedDirectoryHandle,
  clearSavedDirectoryHandleIfMatches,
  listDirectoryChildren,
  loadQuickEditLaunchImages,
  loadSavedRootPaths,
  saveRootPaths,
  removeSavedRootByPath,
  scanImagesFromFolderPath,
  toRelativeTail,
} from './utils/directoryPicker';
import { DropZone } from './components/DropZone';
import Toolbar from './components/Toolbar/Toolbar';
import MainLayout from './layouts/MainLayout';
import CommandPalette from './components/CommandPalette';
import { DropOverlay, type DropRegion } from './components/common/DropOverlay';

interface DragContext {
  files: number;
  folders: number;
}
import ExportPlanModal from './components/modals/ExportPlanModal';
import WatermarkSettingsModal from './components/modals/WatermarkSettingsModal';
import ProcessingOverlay from './components/common/ProcessingOverlay';
import ToastContainer from './components/common/ToastContainer';
import ResizeHandles from './components/common/ResizeHandles';
import useStore from './store/useStore';
import {
  clearFolderDraft,
  type FolderDraftPayload,
  type FolderDraftPayloadByPath,
  loadFolderDraftPayloads,
  persistFolderDrafts,
  resolveDraftsForImages,
} from './utils/editDraftPersistence';
import { useImageUpload } from './hooks/useImageUpload';
import { useClipboardPaste } from './hooks/useClipboardPaste';
import type {
  ApplyCropToImagesOptions,
  CropEntry,
  DirectoryHandle,
  DirectoryRoot,
  FolderNode,
  GalleryImage,
  ImageFilterType,
  InspectorMode,
  NativeRootScan,
  RawUploadImage,
  SortOption,
} from './types/app';
import './App.css';

const EXPLORER_OPEN_STORAGE_KEY = 'bb-explorer-open';
const EXPANDED_PATHS_STORAGE_KEY = 'bb-expanded-paths';
const ACTIVE_FOLDER_STORAGE_KEY = 'bb-active-folder-path';
const LINKED_ROOT_NAMES_STORAGE_KEY = 'bb-linked-root-names';
const INSPECTOR_MODE_STORAGE_KEY = 'bb-inspector-mode';
const ALL_FOLDERS_VALUE = '__all__';
const FOLDER_INITIAL_IMAGE_BATCH = 240;
const FOLDER_LOAD_MORE_BATCH = 180;
const MIN_ROW_HEIGHT = 150;
const MAX_ROW_HEIGHT = 500;
const ROW_HEIGHT_STEP = 4;
const SHUFFLE_SEED_MAX = 0x7fffffff;
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const normalizePath = (value: unknown): string =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
const getFolderNameFromPath = (value: unknown): string => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};
const getRootFolderPathFromRelativePath = (relativePath: string): string =>
  normalizePath(relativePath).split('/').filter(Boolean)[0] || '';
const getRootTokenFromPath = (value: string): string =>
  normalizePath(value).split('/').filter(Boolean)[0] || '';
const snapRowHeight = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : MIN_ROW_HEIGHT;
  const clamped = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, safeValue));
  const snapped =
    MIN_ROW_HEIGHT +
    Math.round((clamped - MIN_ROW_HEIGHT) / ROW_HEIGHT_STEP) * ROW_HEIGHT_STEP;
  return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, snapped));
};
const isImageInFolderSubtree = (
  relativePath: string,
  folderPath: string,
): boolean => {
  const normalizedRelativePath = normalizePath(relativePath);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRelativePath || !normalizedFolderPath) return false;
  return normalizedRelativePath.startsWith(`${normalizedFolderPath}/`);
};

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === '1';
};

const readStoredString = (key: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) ?? fallback;
};

const readStoredStringArray = (key: string): string[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

const persistStorageValue = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
};

const areSameDirectoryHandles = async (
  a: DirectoryHandle | null | undefined,
  b: DirectoryHandle | null | undefined,
): Promise<boolean> => {
  if (!a || !b || typeof a.isSameEntry !== 'function') return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
};

const isDirectoryAncestor = async (
  ancestor: DirectoryHandle | null | undefined,
  descendant: DirectoryHandle | null | undefined,
): Promise<boolean> => {
  if (!ancestor || !descendant || typeof ancestor.resolve !== 'function') {
    return false;
  }
  try {
    const relative = await ancestor.resolve(descendant);
    return Array.isArray(relative);
  } catch {
    return false;
  }
};

const getEffectiveModifiedTimestamp = (
  image: GalleryImage,
  sessionModifiedAt: Map<string, number>,
): number => {
  const sessionTs = Number(sessionModifiedAt.get(image.id) || 0) || 0;
  const sourceTs = Number(image?.sourceLastModified || 0) || 0;
  const loadedTs = Number(image?.loadedAt || 0) || 0;
  const baseTs = sourceTs || loadedTs;
  return Math.max(sessionTs, baseTs);
};

const randomInt = (maxExclusive: number): number =>
  Math.floor(Math.random() * maxExclusive);

const getShuffleScore = (value: string, seed: number): number => {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
};

function App() {
  const {
    images,
    excludedById,
    rowHeight,
    showAllFooters,
    selectedId,
    cropData,
    captionById,
    inspectorWidth,
    format,
    quality,
    setSelectedId,
    setCropChange,
    applyCropToImages,
    setRowHeight,
    setInspectorWidth,
    explorerWidth,
    setExplorerWidth,
    sortOption,
    sortOrder,
    setSortOption,
    applyPersistedImageDrafts,
    clearDraftsForFolder,
    deleteFolder,
    folderNodes,
    rootNames,
    addImages,
    clearImages,
    deleteImage,
    expandedPaths,
    toggleExpandedPath,
    setExpandedPaths,
    setImages,
    setLastUsedHardware,
    isSingleEditMode,
    isVirtualBatch,
    virtualBatchName,
    setSingleEditMode,
    setVirtualBatchMode,
    showExcluded,
    setShowExcluded,
    activeFilters,
    toggleFilter,
    clearFilters,
    addToast,
  } = useStore();

  const mapNativeToRaw = (img: any): RawUploadImage => {
    const absolutePath = img.absolutePath || '';
    const encoded = encodeURIComponent(absolutePath).replace(/%2F/g, '/');
    const assetUrl = `localfile://localhost${encoded.startsWith('/') ? '' : '/'}${encoded}`;

    return {
      file: new File([], img.fileName || 'image.jpg'),
      id: `drop-${absolutePath}-${Math.random().toString(36).substring(2, 7)}`,
      relativePath: img.relativePath || '',
      absolutePath,
      assetUrl,
      nativeSize: img.size || 0,
      nativeWidth: img.width || 0,
      nativeHeight: img.height || 0,
      nativeAccessedAt: (img.accessedAt || 0) * 1000,
      nativeCreatedAt: (img.createdAt || 0) * 1000,
      nativeLastModifiedAt: (img.lastModified || 0) * 1000,
    };
  };

  const [isDragging, setIsDragging] = useState(false);
  const [dragContext, setDragContext] = useState<DragContext | null>(null);
  const [dropRegion, setDropRegion] = useState<DropRegion>(null);
  const dropRegionRef = useRef<DropRegion>(null);

  useEffect(() => {
    dropRegionRef.current = dropRegion;
  }, [dropRegion]);

  const addMoreRef = useRef<HTMLInputElement | null>(null);
  const {
    handleImagesLoaded,
    handleAddMore,
    handlePickFolderViaDirectoryPicker,
  } = useImageUpload();



  const linkedRootsHydratedRef = useRef<boolean>(false);
  const cachedRootNamesBootstrappedRef = useRef<boolean>(false);
  const rowHeightRafRef = useRef<number>(0);
  const pendingRowHeightRef = useRef<number>(rowHeight);
  const directoryRootsRef = useRef<DirectoryRoot[]>([]);
  const loadedFolderScanKeysRef = useRef<Set<string>>(new Set());
  const loadingFolderScanKeysRef = useRef<Set<string>>(new Set());
  const folderScanNextOffsetRef = useRef<Map<string, number>>(new Map());
  const folderScanHasMoreRef = useRef<Map<string, boolean>>(new Map());
  const draftPersistTimerRef = useRef<number>(0);
  const restoredDraftImageIdsRef = useRef<Set<string>>(new Set());
  const loadedDraftPayloadByFolderRef = useRef<Map<string, FolderDraftPayload | null>>(
    new Map(),
  );
  const loadingDraftPayloadFoldersRef = useRef<Set<string>>(new Set());
  const [explorerOpen, setExplorerOpen] = useState(() =>
    readStoredBoolean(EXPLORER_OPEN_STORAGE_KEY, true),
  );
  const [activeFolderPath, setActiveFolderPath] = useState(() =>
    readStoredString(ACTIVE_FOLDER_STORAGE_KEY, ALL_FOLDERS_VALUE),
  );
  const [cachedLinkedRootNames] = useState<string[]>(() => {
    const activeStoredPath = readStoredString(
      ACTIVE_FOLDER_STORAGE_KEY,
      ALL_FOLDERS_VALUE,
    );
    const names = readStoredStringArray(LINKED_ROOT_NAMES_STORAGE_KEY);
    if (activeStoredPath && activeStoredPath !== ALL_FOLDERS_VALUE) {
      names.push(getFolderNameFromPath(activeStoredPath));
    }
    return Array.from(new Set(names.filter(Boolean)));
  });
  const [shuffleSeed, setShuffleSeed] = useState<number>(() =>
    randomInt(SHUFFLE_SEED_MAX),
  );
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>(() => {
    const stored = readStoredString(INSPECTOR_MODE_STORAGE_KEY, 'edit');
    return stored === 'view' ? 'view' : 'edit';
  });
  const [launchContextResolved, setLaunchContextResolved] = useState(() =>
    typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window),
  );
  const [quickEditMode, setQuickEditMode] = useState(false);
  const [startupRootsResolved, setStartupRootsResolved] = useState(false);
  const [loadingFolderPaths, setLoadingFolderPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [exportPlanOpen, setExportPlanOpen] = useState(false);
  const settingsModal = useStore((state) => state.settingsModal);
  const openSettings = useStore((state) => state.openSettings);
  const closeSettings = useStore((state) => state.closeSettings);
  const [exportFolderSelectionMode, setExportFolderSelectionMode] = useState(false);
  const [selectedExportFolderPaths, setSelectedExportFolderPaths] = useState<
    Set<string>
  >(() => new Set());
  const [treeFolderNodes, setTreeFolderNodes] = useState<FolderNode[]>([]);
  const [loadingTreePaths, setLoadingTreePaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [directoryRootsVersion, setDirectoryRootsVersion] = useState(0);
  const loadedTreePathsRef = useRef<Set<string>>(new Set());
  const loadingTreePathsRef = useRef<Set<string>>(new Set());
  const activeFolderAbsolutePathRef = useRef<string>('');

  const handlePastedImages = useCallback(
    async (pastedImages: RawUploadImage[]) => {
      if (pastedImages.length === 0) return;
      try {
        await setImages(pastedImages, []);
        setActiveFolderPath(ALL_FOLDERS_VALUE);
        setSingleEditMode(true);
        setVirtualBatchMode(false);

        if (pastedImages[0]?.id) {
          setSelectedId(pastedImages[0].id);
        }
        addToast('Image pasted from clipboard', 'success');
      } catch (err) {
        console.error('Failed to load pasted image:', err);
        addToast('Failed to load pasted image', 'error');
      }
    },
    [setImages, setActiveFolderPath, setSingleEditMode, setVirtualBatchMode, setSelectedId, addToast],
  );

  useClipboardPaste({
    onPaste: handlePastedImages,
    onError: (err) => {
      addToast(`Paste failed: ${err}`, 'error');
    },
    enabled: true,
  });

  const markFolderLoading = useCallback(
    (paths: string[], loading: boolean) => {
      const safePaths = paths.filter(Boolean);
      if (safePaths.length === 0) return;
      setLoadingFolderPaths((previous) => {
        const next = new Set(previous);
        safePaths.forEach((path) => {
          if (loading) {
            next.add(path);
          } else {
            next.delete(path);
          }
        });
        return next;
      });
    },
    [],
  );

  const markTreePathLoading = useCallback(
    (paths: string[], loading: boolean) => {
      const safePaths = paths.filter(Boolean);
      if (safePaths.length === 0) return;
      setLoadingTreePaths((previous) => {
        const next = new Set(previous);
        safePaths.forEach((path) => {
          if (loading) {
            next.add(path);
          } else {
            next.delete(path);
          }
        });
        return next;
      });
    },
    [],
  );

  const handleRowHeightChange = useCallback(
    (nextValue: number) => {
      const snappedValue = snapRowHeight(nextValue);
      if (pendingRowHeightRef.current === snappedValue) return;
      pendingRowHeightRef.current = snappedValue;
      if (rowHeightRafRef.current) return;
      rowHeightRafRef.current = requestAnimationFrame(() => {
        rowHeightRafRef.current = 0;
        const nextSnappedValue = pendingRowHeightRef.current;
        if (useStore.getState().rowHeight === nextSnappedValue) return;
        setRowHeight(nextSnappedValue);
      });
    },
    [setRowHeight],
  );

  const handleSetSortOption = useCallback(
    (option: SortOption) => {
      if (option === 'shuffle') {
        setShuffleSeed(randomInt(SHUFFLE_SEED_MAX));
      }
      setSortOption(option);
    },
    [setSortOption],
  );

  useEffect(() => {
    pendingRowHeightRef.current = rowHeight;
  }, [rowHeight]);

  const activateQuickEditMode = useCallback(
    async (launchImages: Awaited<ReturnType<typeof loadQuickEditLaunchImages>>) => {
      if (!Array.isArray(launchImages) || launchImages.length === 0) return;

      setQuickEditMode(true);
      setLaunchContextResolved(true);
      setStartupRootsResolved(true);
      setActiveFolderPath(ALL_FOLDERS_VALUE);
      setExplorerOpen(true);
      setExportFolderSelectionMode(false);
      setSelectedExportFolderPaths(new Set());
      directoryRootsRef.current = [];
      setDirectoryRootsVersion((previous) => previous + 1);
      loadedTreePathsRef.current = new Set();
      loadingTreePathsRef.current = new Set();
      loadedFolderScanKeysRef.current = new Set();
      loadingFolderScanKeysRef.current = new Set();
      folderScanNextOffsetRef.current = new Map();
      folderScanHasMoreRef.current = new Map();
      loadedDraftPayloadByFolderRef.current = new Map();
      loadingDraftPayloadFoldersRef.current = new Set();
      restoredDraftImageIdsRef.current = new Set();
      setTreeFolderNodes([]);
      setLoadingTreePaths(new Set());
      setLoadingFolderPaths(new Set());
      clearImages();

      await addImages(launchImages, ['Quick Edit']);
      if (launchImages[0]?.id) {
        setSelectedId(launchImages[0].id);
      }
    },
    [addImages, clearImages, setSelectedId],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      try {
        unlisten = await listen<string>('watermark-engine-status', (event) => {
          if (useStore.getState().processingState.isActive) {
            useStore.getState().setProcessingState({ statusText: event.payload });
          }
        });
      } catch (e) {
        console.error('Failed to setup engine status listener:', e);
      }
    };
    void setupListener();
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let activatedQuickMode = false;

    const resolveLaunchContext = async () => {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        if (!cancelled) setLaunchContextResolved(true);
        return;
      }

      try {
        const launchImages = await loadQuickEditLaunchImages();
        if (cancelled) return;
        if (launchImages.length === 0) return;

        activatedQuickMode = true;
        await activateQuickEditMode(launchImages);
      } catch (error) {
        console.warn('Failed to resolve launch quick-edit image:', error);
      } finally {
        if (!cancelled) {
          setLaunchContextResolved(true);
          if (activatedQuickMode) {
            setStartupRootsResolved(true);
          }
        }
      }
    };

    void resolveLaunchContext();

    return () => {
      cancelled = true;
    };
  }, [activateQuickEditMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const attachListener = async () => {
      try {
        unlisten = await listen('quick-edit-open-requested', async () => {
          const launchImages = await loadQuickEditLaunchImages();
          if (cancelled || launchImages.length === 0) return;
          await activateQuickEditMode(launchImages);
        });
      } catch (error) {
        console.warn('Failed to attach quick-edit open listener:', error);
      }
    };

    void attachListener();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [activateQuickEditMode]);

  useEffect(() => {
    if (images.length !== 0) return;
    restoredDraftImageIdsRef.current = new Set();
    loadedDraftPayloadByFolderRef.current = new Map();
    loadingDraftPayloadFoldersRef.current = new Set();
  }, [images.length]);

  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    if (cachedRootNamesBootstrappedRef.current) return;
    if (images.length > 0 || folderNodes.length > 0) return;
    cachedRootNamesBootstrappedRef.current = true;

    const cachedRootNames = Array.from(
      new Set(readStoredStringArray(LINKED_ROOT_NAMES_STORAGE_KEY)),
    );
    if (cachedRootNames.length > 0) {
      addImages([], cachedRootNames);
    }
  }, [addImages, folderNodes.length, images.length, launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) {
      setStartupRootsResolved(true);
      return;
    }
    if (linkedRootsHydratedRef.current) return;
    if (images.length > 0) {
      setStartupRootsResolved(true);
      return;
    }
    linkedRootsHydratedRef.current = true;

    loadSavedRootPaths().then((rootPaths) => {
      if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
        directoryRootsRef.current = [];
        setDirectoryRootsVersion((previous) => previous + 1);
        loadedTreePathsRef.current = new Set();
        loadingTreePathsRef.current = new Set();
        setTreeFolderNodes([]);
        setLoadingTreePaths(new Set());
        persistStorageValue(LINKED_ROOT_NAMES_STORAGE_KEY, JSON.stringify([]));
        return;
      }
      const nextRoots = rootPaths.map(
        (rootPath: string): DirectoryRoot => ({
          rootPath,
          rootName: getFolderNameFromPath(rootPath),
          handle: null,
        }),
      );
      directoryRootsRef.current = nextRoots;
      setDirectoryRootsVersion((previous) => previous + 1);
      const rootNames = nextRoots
        .map((root) => root.rootName)
        .filter((name) => Boolean(name));
      persistStorageValue(
        LINKED_ROOT_NAMES_STORAGE_KEY,
        JSON.stringify(Array.from(new Set(rootNames))),
      );
      if (rootNames.length > 0) {
        addImages([], Array.from(new Set(rootNames)));
      }
    }).finally(() => {
      setStartupRootsResolved(true);
    });
  }, [addImages, launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    // Expanded paths restoration
    const storedExpanded = localStorage.getItem(EXPANDED_PATHS_STORAGE_KEY);
    if (storedExpanded) {
      try {
        const parsed = JSON.parse(storedExpanded);
        if (Array.isArray(parsed)) {
          setExpandedPaths(new Set(parsed));
        }
      } catch (err) {
        console.error('Failed to parse stored expanded paths:', err);
      }
    }
  }, [launchContextResolved, quickEditMode, setExpandedPaths]);

  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    window.localStorage.setItem(
      EXPANDED_PATHS_STORAGE_KEY,
      JSON.stringify(Array.from(expandedPaths)),
    );
  }, [expandedPaths, launchContextResolved, quickEditMode]);

  useEffect(() => {
    persistStorageValue(INSPECTOR_MODE_STORAGE_KEY, inspectorMode);
  }, [inspectorMode]);

  const mergeTreeNodes = useCallback(
    (newNodes: FolderNode[], options: { pruneToRoots?: string[] } = {}) => {
      setTreeFolderNodes((previousNodes) => {
        const byPath = new Map<string, FolderNode>();
        const allowedRoots = options.pruneToRoots
          ? new Set(options.pruneToRoots)
          : null;

        previousNodes.forEach((node) => {
          const normalizedNodePath = normalizePath(node.path);
          const isAllowed =
            !allowedRoots ||
            Array.from(allowedRoots).some(
              (root) =>
                normalizedNodePath === root ||
                normalizedNodePath.startsWith(root + '/'),
            );
          if (!isAllowed) return;
          byPath.set(node.path, node);
        });

        newNodes.forEach((node) => {
          const existing = byPath.get(node.path);
          byPath.set(node.path, {
            ...(existing || {}),
            ...node,
            depth: Math.max(0, Number(node.depth || existing?.depth || 0)),
            count: Math.max(0, Number(node.count ?? existing?.count ?? 0)),
          });
        });

        return Array.from(byPath.values()).sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      });
    },
    [],
  );

  const resolveRootForFolderPath = useCallback((folderPath: string) => {
    const normalized = normalizePath(folderPath);
    if (!normalized) return null;

    const root = directoryRootsRef.current.find(
      (candidate) =>
        normalized === candidate.rootName ||
        normalized.startsWith(candidate.rootName + '/') ||
        (candidate.rootPath &&
          (normalized === candidate.rootPath ||
            normalized.startsWith(candidate.rootPath + '/'))),
    );

    if (!root) return null;

    return {
      root,
      rootToken: root.rootName,
    };
  }, []);

  const loadTreeChildrenForPath = useCallback(
    async (folderPath: string) => {
      const normalizedFolderPath = normalizePath(folderPath);
      if (!normalizedFolderPath || normalizedFolderPath === ALL_FOLDERS_VALUE) {
        return;
      }
      if (loadedTreePathsRef.current.has(normalizedFolderPath)) return;
      if (loadingTreePathsRef.current.has(normalizedFolderPath)) return;

      const resolved = resolveRootForFolderPath(normalizedFolderPath);
      if (!resolved) return;

      const { root } = resolved;
      loadingTreePathsRef.current.add(normalizedFolderPath);
      markTreePathLoading([normalizedFolderPath], true);
      try {
        const children = await listDirectoryChildren({
          rootPath: root.rootPath,
          rootName: root.rootName,
          folderPath: normalizedFolderPath,
        });

        mergeTreeNodes(
          [
            {
              path: normalizedFolderPath,
              name: getFolderNameFromPath(normalizedFolderPath),
              depth: normalizedFolderPath.split('/').filter(Boolean).length - 1,
              count: 0,
              totalCount: 0,
              expandable: children.length > 0,
            },
            ...children,
          ],
        );
        loadedTreePathsRef.current.add(normalizedFolderPath);
      } catch (err) {
      } finally {
        loadingTreePathsRef.current.delete(normalizedFolderPath);
        markTreePathLoading([normalizedFolderPath], false);
      }
    },
    [markTreePathLoading, mergeTreeNodes, resolveRootForFolderPath],
  );

  const loadedRootPaths = useMemo(() => {
    const roots = new Set<string>();
    images.forEach((image: GalleryImage) => {
      const root = getRootFolderPathFromRelativePath(image?.relativePath);
      if (root) roots.add(root);
    });
    return Array.from(roots);
  }, [images]);

  const linkedRootNamesFromPaths = useMemo(
    () =>
      Array.from(
        new Set(
          directoryRootsRef.current
            .map((root) => root.rootName)
            .filter(Boolean),
        ),
      ),
    [directoryRootsVersion],
  );

  const effectiveRootNames = useMemo(() => {
    const source =
      Array.isArray(rootNames) && rootNames.length > 0
        ? rootNames
        : linkedRootNamesFromPaths;
    const result = Array.from(new Set(source.filter(Boolean)));
    return result;
  }, [linkedRootNamesFromPaths, rootNames]);

  useEffect(() => {
    const uniqueRoots = Array.from(new Set(effectiveRootNames.filter(Boolean)));

    const isPathAllowedByRoots = (path: string): boolean => {
      const normalizedPath = normalizePath(path);
      if (!normalizedPath) return false;
      const allowed = uniqueRoots.some(
        (root) =>
          normalizedPath === root || normalizedPath.startsWith(root + '/'),
      );
      return allowed;
    };

    const isScanKeyAllowedByRoots = (scanKey: string): boolean => {
      const pathPart = String(scanKey || '').split('::')[0] || '';
      return isPathAllowedByRoots(pathPart);
    };

    loadedTreePathsRef.current = new Set(
      Array.from(loadedTreePathsRef.current).filter(isPathAllowedByRoots),
    );
    loadingTreePathsRef.current = new Set(
      Array.from(loadingTreePathsRef.current).filter(isPathAllowedByRoots),
    );
    loadedFolderScanKeysRef.current = new Set(
      Array.from(loadedFolderScanKeysRef.current).filter(
        isScanKeyAllowedByRoots,
      ),
    );
    loadingFolderScanKeysRef.current = new Set(
      Array.from(loadingFolderScanKeysRef.current).filter(
        isScanKeyAllowedByRoots,
      ),
    );
    folderScanNextOffsetRef.current = new Map(
      Array.from(folderScanNextOffsetRef.current.entries()).filter(([key]) =>
        isScanKeyAllowedByRoots(key),
      ),
    );
    folderScanHasMoreRef.current = new Map(
      Array.from(folderScanHasMoreRef.current.entries()).filter(([key]) =>
        isScanKeyAllowedByRoots(key),
      ),
    );

    const rootNodes: FolderNode[] = uniqueRoots.map((name) => ({
      path: name,
      name,
      depth: 0,
      count: 0,
      totalCount: 0,
      expandable: true,
    }));
    mergeTreeNodes(rootNodes, { pruneToRoots: uniqueRoots });

    setLoadingTreePaths((previous) => {
      const next = new Set<string>();
      previous.forEach((path) => {
        if (isPathAllowedByRoots(path)) {
          next.add(path);
        }
      });
      return next;
    });

  }, [
    effectiveRootNames,
    mergeTreeNodes,
  ]);

  const effectiveFolderNodes = useMemo(() => {
    const countsByPath = new Map<string, { count: number, totalCount: number }>();
    folderNodes.forEach((node) => {
      countsByPath.set(normalizePath(node.path), {
        count: Math.max(0, node.count || 0),
        totalCount: Math.max(0, node.totalCount || 0),
      });
    });

    const mergeNode = (node: FolderNode) => {
      const stats = countsByPath.get(normalizePath(node.path));
      return {
        ...node,
        count: stats?.count ?? node.count,
        totalCount: stats?.totalCount ?? node.totalCount ?? node.count, // Fallback to count if totalCount missing
      };
    };

    if (treeFolderNodes.length > 0) {
      return treeFolderNodes.map(mergeNode);
    }

    return effectiveRootNames.map((name) => {
      const stats = countsByPath.get(normalizePath(name));
      return {
        path: name,
        name,
        depth: 0,
        count: stats?.count ?? 0,
        totalCount: stats?.totalCount ?? 0,
        expandable: true,
      };
    });
  }, [effectiveRootNames, folderNodes, treeFolderNodes]);



  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    if (images.length !== 0) return;
    if (folderNodes.length !== 0) return;
    const rootNames = directoryRootsRef.current
      .map((root) => root.rootName)
      .filter(Boolean);
    if (rootNames.length === 0) return;
    addImages([], Array.from(new Set(rootNames)));
  }, [addImages, folderNodes.length, images.length, launchContextResolved, quickEditMode]);

  const scopedImages = useMemo(() => {
    let base: GalleryImage[];
    if (activeFolderPath === ALL_FOLDERS_VALUE) {
      base = images;
    } else {
      const prefix = `${activeFolderPath}/`;
      base = images.filter((image) => {
        const relativePath = normalizePath(image.relativePath);
        if (!relativePath.startsWith(prefix)) return false;
        const remainder = relativePath.substring(prefix.length);
        return !remainder.includes('/');
      });
    }

    if (showExcluded) {
      // already base
    } else {
      base = base.filter((img) => !excludedById.has(img.id));
    }

    if (activeFilters.size === 0) {
      return base;
    }

    return base.filter((image) => {
      const entry = cropData.get(image.id);
      const caption = captionById.get(image.id);

      return Array.from(activeFilters).every((filter) => {
        switch (filter) {
          case 'cropped': {
            const coords = entry?.coordinates;
            if (!coords) return false;
            // Check if it's not the default full-image crop
            const isDefault =
              Math.abs(coords.left) < 0.1 &&
              Math.abs(coords.top) < 0.1 &&
              Math.abs(coords.width - image.naturalWidth) < 0.1 &&
              Math.abs(coords.height - image.naturalHeight) < 0.1;
            return !isDefault;
          }
          case 'transformed': {
            const rotate = entry?.transforms?.rotate || 0;
            const flip = entry?.transforms?.flip || { horizontal: false, vertical: false };
            return rotate !== 0 || flip.horizontal || flip.vertical;
          }
          case 'has_caption':
            return !!caption;
          case 'has_ai_edits':
            return (entry?.sourceEditHistory?.length || 0) > 0;
          case 'has_tweaks': {
            const hasPadding = entry?.padding && (typeof entry.padding === 'string' || (entry.padding.top > 0 || entry.padding.right > 0 || entry.padding.bottom > 0 || entry.padding.left > 0));
            const hasRadius = entry?.cornerRadius && (typeof entry.cornerRadius === 'string' || (entry.cornerRadius.topLeft > 0 || entry.cornerRadius.topRight > 0 || entry.cornerRadius.bottomRight > 0 || entry.cornerRadius.bottomLeft > 0));
            return !!(hasPadding || hasRadius);
          }
          case 'has_resize':
            return (entry?.outputWidth || 0) > 0;
          default:
            return true;
        }
      });
    });
  }, [activeFolderPath, images, isSingleEditMode, isVirtualBatch, showExcluded, excludedById, activeFilters, cropData, captionById]);

  const visibleImages = useMemo(() => {
    const next = scopedImages.map((image, originalIndex) => ({
      image,
      originalIndex,
    }));

    next.sort((entryA, entryB) => {
      const a = entryA.image;
      const b = entryB.image;

      if (sortOption === 'name') {
        const byName = nameCollator.compare(a.name || '', b.name || '');
        if (byName !== 0) return sortOrder === 'asc' ? byName : -byName;
      } else if (sortOption === 'size') {
        const bySize = (a.sourceSize || 0) - (b.sourceSize || 0);
        if (bySize !== 0) return sortOrder === 'asc' ? bySize : -bySize;
      } else if (sortOption === 'aspect_ratio') {
        const byRatio = (a.naturalRatio || 0) - (b.naturalRatio || 0);
        if (byRatio !== 0) return sortOrder === 'asc' ? byRatio : -byRatio;
      } else if (sortOption === 'last_modified') {
        const currentModTimes = useStore.getState().sessionModifiedAt;
        const byModifiedA = getEffectiveModifiedTimestamp(a, currentModTimes);
        const byModifiedB = getEffectiveModifiedTimestamp(b, currentModTimes);
        const byModified = byModifiedA - byModifiedB;
        if (byModified !== 0) return sortOrder === 'asc' ? byModified : -byModified;
      } else if (sortOption === 'shuffle') {
        const byShuffle =
          getShuffleScore(a.id || a.relativePath || a.name || '', shuffleSeed) -
          getShuffleScore(b.id || b.relativePath || b.name || '', shuffleSeed);
        if (byShuffle !== 0) return byShuffle;
      }

      const byPath = nameCollator.compare(
        a.relativePath || a.name || '',
        b.relativePath || b.name || '',
      );
      if (byPath !== 0) return byPath;

      const byId = nameCollator.compare(a.id || '', b.id || '');
      if (byId !== 0) return byId;

      return entryA.originalIndex - entryB.originalIndex;
    });

    return next.map((entry) => entry.image);
  }, [scopedImages, shuffleSeed, sortOption, sortOrder]); // Deliberately omitting sessionModifiedAt to avoid lag

  const navigableVisibleImages = useMemo(
    () => visibleImages.filter((image) => !excludedById.has(image.id)),
    [excludedById, visibleImages],
  );

  const selectedFolderScopeImages = useMemo(() => {
    if (selectedExportFolderPaths.size === 0) return [];
    const selectedPaths = Array.from(selectedExportFolderPaths)
      .map((path) => normalizePath(path))
      .filter(Boolean);
    if (selectedPaths.length === 0) return [];

    const seen = new Set<string>();
    const next: GalleryImage[] = [];
    images.forEach((image) => {
      const relativePath = normalizePath(image.relativePath);
      const belongsToSelectedFolder = selectedPaths.some((folderPath) => {
        if (!folderPath || folderPath === ALL_FOLDERS_VALUE) return false;
        if (relativePath === folderPath) return true;
        return relativePath.startsWith(`${folderPath}/`);
      });
      if (!belongsToSelectedFolder || seen.has(image.id)) return;
      seen.add(image.id);
      next.push(image);
    });
    return next;
  }, [images, selectedExportFolderPaths]);

  const visibleImageIds = useMemo(
    () => new Set(navigableVisibleImages.map((image) => image.id)),
    [navigableVisibleImages],
  );

  const handleSelectNext = useCallback(() => {
    if (!selectedId) return;
    const index = navigableVisibleImages.findIndex(
      (image) => image.id === selectedId,
    );
    if (index < 0 || index >= navigableVisibleImages.length - 1) return;
    setSelectedId(navigableVisibleImages[index + 1].id);
  }, [navigableVisibleImages, selectedId, setSelectedId]);

  const handleSelectPrev = useCallback(() => {
    if (!selectedId) return;
    const index = navigableVisibleImages.findIndex(
      (image) => image.id === selectedId,
    );
    if (index <= 0) return;
    setSelectedId(navigableVisibleImages[index - 1].id);
  }, [navigableVisibleImages, selectedId, setSelectedId]);

  const handleExcludeSelected = useCallback(
    (targetId: string) => {
      if (targetId === selectedId) {
        const index = navigableVisibleImages.findIndex(
          (image) => image.id === targetId,
        );
        if (index >= 0) {
          if (index < navigableVisibleImages.length - 1) {
            setSelectedId(navigableVisibleImages[index + 1].id);
          } else if (index > 0) {
            setSelectedId(navigableVisibleImages[index - 1].id);
          } else {
            setSelectedId(null);
          }
        }
      }
      useStore.getState().deleteImage(targetId);
    },
    [navigableVisibleImages, selectedId, setSelectedId],
  );

  const handleRestoreExcluded = useCallback((targetId: string) => {
    useStore.getState().restoreImage(targetId);
  }, []);

  const exportableCurrentFolderImages = useMemo(
    () => visibleImages.filter((image) => !excludedById.has(image.id)),
    [excludedById, visibleImages],
  );

  const { consideredCount, totalCount } = useMemo(() => {
    if (isSingleEditMode || isVirtualBatch) {
      return { consideredCount: images.length, totalCount: images.length };
    }

    if (activeFolderPath === ALL_FOLDERS_VALUE) {
      const total = images.length;
      const considered = images.filter((img) => !excludedById.has(img.id)).length;
      return { consideredCount: considered, totalCount: total };
    }

    const node = folderNodes.find((n) => normalizePath(n.path) === normalizePath(activeFolderPath));
    if (node) {
      return { consideredCount: node.count, totalCount: node.totalCount };
    }

    return { consideredCount: 0, totalCount: 0 };
  }, [activeFolderPath, images, excludedById, folderNodes, isSingleEditMode, isVirtualBatch]);

  const loadImagesForFolderPath = useCallback(
    async (
      folderPath: string,
      options: { append?: boolean; recursive?: boolean; bypassCache?: boolean } = {},
    ) => {
      const append = Boolean(options.append);
      const recursive = Boolean(options.recursive);
      const normalizedFolderPath = normalizePath(folderPath);
      if (!normalizedFolderPath || normalizedFolderPath === ALL_FOLDERS_VALUE) {
        return;
      }

      const resolved = resolveRootForFolderPath(normalizedFolderPath);
      if (!resolved) return;

      const { root, rootToken } = resolved;
      const scanKey = `${normalizedFolderPath}::direct`;
      const isVerifiedInSession = loadedFolderScanKeysRef.current.has(scanKey);

      // --- PATH 1: Folder Entry (Sync) ---
      if (!append) {
        try {
          const relativeTail = toRelativeTail(root.rootName, normalizedFolderPath);
          const checkPath = relativeTail ? `${root.rootPath}/${relativeTail}` : root.rootPath;

          const diskLastModified = await invoke<number>('get_folder_last_modified', {
            folderPath: checkPath
          }).catch(() => 0);
          
          const storedLastModified = useStore.getState().folderLastModified.get(normalizedFolderPath) || 0;
          
          // If we already verified it in this session AND the disk hasn't changed, skip.
          if (!options.bypassCache && isVerifiedInSession && diskLastModified > 0 && diskLastModified <= storedLastModified) {
            return;
          }

          // Perform full sync (limit 0)
          const loadingKeys = Array.from(new Set([normalizedFolderPath, rootToken, root.rootName, root.rootPath])).filter(Boolean);
          markFolderLoading(loadingKeys, true);

          const scanResult = await scanImagesFromFolderPath({
            rootPath: root.rootPath,
            rootName: root.rootName,
            folderPath: normalizedFolderPath,
            recursive,
            offset: 0,
            limit: 0,
          });

          await useStore.getState().refreshImagesForFolder(normalizedFolderPath, scanResult.images);
          
          // Update verification state and timestamp
          useStore.getState().updateFolderLastModified(normalizedFolderPath, diskLastModified || Math.floor(Date.now() / 1000));
          loadedFolderScanKeysRef.current.add(scanKey);
          
          // Reset pagination
          folderScanNextOffsetRef.current.set(scanKey, scanResult.images.length);
          folderScanHasMoreRef.current.set(scanKey, false);
          return;
        } catch (err) {
          console.error('Failed to sync folder on entry:', err);
        } finally {
          const loadingKeys = Array.from(new Set([normalizedFolderPath, rootToken, root.rootName, root.rootPath])).filter(Boolean);
          markFolderLoading(loadingKeys, false);
        }
      }

      // --- PATH 2: Paging (Append) ---
      if (folderScanHasMoreRef.current.get(scanKey) === false) return;
      if (loadingFolderScanKeysRef.current.has(scanKey)) return;

      try {
        const offset = Math.max(0, folderScanNextOffsetRef.current.get(scanKey) || 0);
        const limit = FOLDER_LOAD_MORE_BATCH;

        loadingFolderScanKeysRef.current.add(scanKey);
        const loadingKeys = Array.from(new Set([normalizedFolderPath, rootToken, root.rootName, root.rootPath, scanKey])).filter(Boolean);
        markFolderLoading(loadingKeys, true);

        const scanResult = await scanImagesFromFolderPath({
          rootPath: root.rootPath,
          rootName: root.rootName,
          folderPath: normalizedFolderPath,
          recursive,
          offset,
          limit,
        });

        await addImages(scanResult.images, [root.rootName]);

        const nextOffset = offset + (Array.isArray(scanResult.images) ? scanResult.images.length : 0);
        folderScanNextOffsetRef.current.set(scanKey, nextOffset);
        const hasMore = Array.isArray(scanResult.images) && limit > 0 && scanResult.images.length >= limit;
        folderScanHasMoreRef.current.set(scanKey, hasMore);
      } finally {
        loadingFolderScanKeysRef.current.delete(scanKey);
        const loadingKeys = Array.from(new Set([normalizedFolderPath, rootToken, root.rootName, root.rootPath, scanKey])).filter(Boolean);
        markFolderLoading(loadingKeys, false);
      }
    },
    [addImages, markFolderLoading, resolveRootForFolderPath],
  );

  const handleSelectFolder = useCallback(
    (folderPath: string) => {
      setActiveFolderPath(folderPath);
      void loadTreeChildrenForPath(folderPath);
      void loadImagesForFolderPath(folderPath);
    },
    [loadImagesForFolderPath, loadTreeChildrenForPath],
  );

  const handleLoadMoreActiveFolder = useCallback(() => {
    if (!activeFolderPath || activeFolderPath === ALL_FOLDERS_VALUE) return;
    void loadImagesForFolderPath(activeFolderPath, { append: true });
  }, [activeFolderPath, loadImagesForFolderPath]);

  const handleRefreshFolder = useCallback(() => {
    if (!activeFolderPath || activeFolderPath === ALL_FOLDERS_VALUE) return;
    void loadImagesForFolderPath(activeFolderPath, { bypassCache: true });
  }, [activeFolderPath, loadImagesForFolderPath]);

  const handleToggleExpand = useCallback(
    (path: string) => {
      if (!expandedPaths.has(path)) {
        void loadTreeChildrenForPath(path);
      }
      toggleExpandedPath(path);
    },
    [expandedPaths, loadTreeChildrenForPath, toggleExpandedPath],
  );

  useEffect(() => {
    if (!startupRootsResolved) return;
    if (activeFolderPath !== ALL_FOLDERS_VALUE) return;
    if (effectiveRootNames.length > 0) {
      setActiveFolderPath(effectiveRootNames[0]);
    }
  }, [activeFolderPath, effectiveRootNames, startupRootsResolved]);

  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    persistStorageValue(EXPLORER_OPEN_STORAGE_KEY, explorerOpen ? '1' : '0');
  }, [explorerOpen, launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return;
    if (!startupRootsResolved) return;
    void loadTreeChildrenForPath(activeFolderPath);
  }, [
    activeFolderPath,
    directoryRootsVersion,
    loadTreeChildrenForPath,
    startupRootsResolved,
  ]);

  useEffect(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return;
    if (!startupRootsResolved) return;
    void loadImagesForFolderPath(activeFolderPath);
  }, [
    activeFolderPath,
    directoryRootsVersion,
    loadImagesForFolderPath,
    startupRootsResolved,
  ]);

  useEffect(() => {
    if (!startupRootsResolved) return;
    expandedPaths.forEach((path) => {
      if (!path || path === ALL_FOLDERS_VALUE) return;
      void loadTreeChildrenForPath(path);
    });
    // This only needs to run once when roots are resolved to handle restoration.
    // Subsequent expansions are handled by handleToggleExpand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupRootsResolved, loadTreeChildrenForPath]);



  useEffect(() => {
    if (!launchContextResolved) return;
    if (quickEditMode) return;
    persistStorageValue(ACTIVE_FOLDER_STORAGE_KEY, activeFolderPath);
  }, [activeFolderPath, launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (!selectedId) return;
    if (visibleImageIds.has(selectedId)) return;
    setSelectedId(null);
  }, [selectedId, setSelectedId, visibleImageIds]);

  useEffect(() => {
    if (!quickEditMode) return;
    if (selectedId) return;
    if (navigableVisibleImages.length === 0) return;
    setSelectedId(navigableVisibleImages[0].id);
  }, [navigableVisibleImages, quickEditMode, selectedId, setSelectedId]);

  useEffect(
    () => () => {
      if (!draftPersistTimerRef.current) return;
      window.clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = 0;
    },
    [],
  );

  useEffect(() => {
    if (!launchContextResolved) return undefined;
    if (quickEditMode) return undefined;
    const schedulePersist = () => {
      if (draftPersistTimerRef.current) {
        window.clearTimeout(draftPersistTimerRef.current);
      }
      draftPersistTimerRef.current = window.setTimeout(() => {
        draftPersistTimerRef.current = 0;
        const state = useStore.getState();
        if (!Array.isArray(state.images) || state.images.length === 0) return;
        persistFolderDrafts({
          images: state.images,
          cropData: state.cropData,
          captionById: state.captionById,
          excludedById: state.excludedById,
          sessionModifiedAt: state.sessionModifiedAt,
        });
      }, 450);
    };

    const unsubscribe = useStore.subscribe(() => {
      schedulePersist();
    });

    return () => {
      unsubscribe();
      if (!draftPersistTimerRef.current) return;
      window.clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = 0;
    };
  }, [launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (!launchContextResolved) return undefined;
    if (quickEditMode) return undefined;
    const flushDraftPersistence = () => {
      const state = useStore.getState();
      if (!Array.isArray(state.images) || state.images.length === 0) return;
      persistFolderDrafts({
        images: state.images,
        cropData: state.cropData,
        captionById: state.captionById,
        excludedById: state.excludedById,
        sessionModifiedAt: state.sessionModifiedAt,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushDraftPersistence();
      }
    };

    window.addEventListener('beforeunload', flushDraftPersistence);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushDraftPersistence);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [launchContextResolved, quickEditMode]);

  useEffect(() => {
    if (!launchContextResolved) return undefined;
    if (quickEditMode) return undefined;
    let cancelled = false;

    if (images.length === 0 || loadedRootPaths.length === 0) {
      restoredDraftImageIdsRef.current = new Set();
      loadedDraftPayloadByFolderRef.current = new Map();
      loadingDraftPayloadFoldersRef.current = new Set();
      return () => {
        cancelled = true;
      };
    }

    const currentImageIds = new Set(images.map((image) => image.id));
    restoredDraftImageIdsRef.current = new Set(
      Array.from(restoredDraftImageIdsRef.current).filter((id) =>
        currentImageIds.has(id),
      ),
    );

    const activeRoots = new Set(loadedRootPaths);
    Array.from(loadedDraftPayloadByFolderRef.current.keys()).forEach(
      (folderPath) => {
        if (activeRoots.has(folderPath)) return;
        loadedDraftPayloadByFolderRef.current.delete(folderPath);
      },
    );

    const applyDraftsFromCache = () => {
      if (cancelled) return;

      const pendingImages = images.filter(
        (image) => !restoredDraftImageIdsRef.current.has(image.id),
      );
      if (pendingImages.length === 0) return;

      const folderDraftPayloads: FolderDraftPayloadByPath = {};
      loadedRootPaths.forEach((folderPath) => {
        const payload = loadedDraftPayloadByFolderRef.current.get(folderPath);
        if (payload) {
          folderDraftPayloads[folderPath] = payload;
        }
      });
      if (Object.keys(folderDraftPayloads).length === 0) return;

      const resolvedDrafts = resolveDraftsForImages({
        images: pendingImages,
        folderDraftPayloads,
      });

      const currentState = useStore.getState();
      const candidateIds = new Set<string>([
        ...Object.keys(resolvedDrafts.cropEntriesById || {}),
        ...Object.keys(resolvedDrafts.captionsById || {}),
        ...Object.keys(resolvedDrafts.excludedById || {}),
        ...Object.keys(resolvedDrafts.modifiedAtById || {}),
      ]);
      if (candidateIds.size === 0) return;

      const applyIds = Array.from(candidateIds).filter((id) => {
        if (restoredDraftImageIdsRef.current.has(id)) return false;
        // Do not override an edit if it was already changed in this session.
        return !currentState.sessionModifiedAt.has(id);
      });
      if (applyIds.length === 0) return;

      const cropEntriesById: Record<string, CropEntry> = {};
      const captionsById: Record<string, string> = {};
      const excludedById: Record<string, boolean> = {};
      const modifiedAtById: Record<string, number> = {};

      applyIds.forEach((id) => {
        const crop = resolvedDrafts.cropEntriesById[id];
        if (crop) {
          cropEntriesById[id] = crop;
        }
        if (Object.prototype.hasOwnProperty.call(resolvedDrafts.captionsById, id)) {
          captionsById[id] = resolvedDrafts.captionsById[id];
        }
        if (Object.prototype.hasOwnProperty.call(resolvedDrafts.excludedById, id)) {
          excludedById[id] = Boolean(resolvedDrafts.excludedById[id]);
        }
        const ts = Number(resolvedDrafts.modifiedAtById[id] || 0);
        if (ts > 0) {
          modifiedAtById[id] = ts;
        }
      });

      if (
        Object.keys(cropEntriesById).length === 0 &&
        Object.keys(captionsById).length === 0 &&
        Object.keys(excludedById).length === 0
      ) {
        return;
      }

      applyPersistedImageDrafts({
        cropEntriesById,
        captionsById,
        excludedById,
        modifiedAtById,
      });
      applyIds.forEach((id) => {
        restoredDraftImageIdsRef.current.add(id);
      });
    };

    const missingFolders = loadedRootPaths.filter(
      (folderPath) =>
        !loadedDraftPayloadByFolderRef.current.has(folderPath) &&
        !loadingDraftPayloadFoldersRef.current.has(folderPath),
    );

    if (missingFolders.length === 0) {
      applyDraftsFromCache();
      return () => {
        cancelled = true;
      };
    }

    applyDraftsFromCache();

    missingFolders.forEach((folderPath) => {
      loadingDraftPayloadFoldersRef.current.add(folderPath);
    });

    loadFolderDraftPayloads(missingFolders)
      .then((payloads) => {
        if (cancelled) return;
        missingFolders.forEach((folderPath) => {
          loadedDraftPayloadByFolderRef.current.set(
            folderPath,
            payloads[folderPath] || null,
          );
        });
        applyDraftsFromCache();
      })
      .catch((error) => {
        console.warn('Failed to auto-restore folder drafts:', error);
        if (cancelled) return;
        missingFolders.forEach((folderPath) => {
          loadedDraftPayloadByFolderRef.current.set(folderPath, null);
        });
        applyDraftsFromCache();
      })
      .finally(() => {
        missingFolders.forEach((folderPath) => {
          loadingDraftPayloadFoldersRef.current.delete(folderPath);
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyPersistedImageDrafts,
    images,
    launchContextResolved,
    loadedRootPaths,
    quickEditMode,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const appWindow = getCurrentWindow();
    let isTogglingFullscreen = false;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isF11 = event.key === 'F11' || event.code === 'F11';
      if (!isF11) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      if (isTogglingFullscreen) return;
      isTogglingFullscreen = true;

      appWindow
        .isFullscreen()
        .then((isFullscreen) => appWindow.setFullscreen(!isFullscreen))
        .catch((error) => {
          console.error('Failed to toggle fullscreen via F11:', error);
        })
        .finally(() => {
          isTogglingFullscreen = false;
        });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (String(event.key || '').toLowerCase() !== 'b') return;

      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      setExplorerOpen((previous: boolean) => !previous);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (!selectedId) return;

      event.preventDefault();

      // Find next ID before deleting to provide smooth navigation
      const currentIndex = navigableVisibleImages.findIndex(
        (img) => img.id === selectedId,
      );
      let nextId: string | null = null;
      if (currentIndex !== -1) {
        if (currentIndex < navigableVisibleImages.length - 1) {
          nextId = navigableVisibleImages[currentIndex + 1].id;
        } else if (currentIndex > 0) {
          nextId = navigableVisibleImages[currentIndex - 1].id;
        }
      }

      deleteImage(selectedId);
      if (nextId) {
        setSelectedId(nextId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteImage, navigableVisibleImages, selectedId, setSelectedId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const appWindow = getCurrentWindow();
    let unlistenDragEnter: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenDragEnter = await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter') {
          const { paths } = event.payload;
          setIsDragging(true);
          
          // Asynchronously determine counts
          try {
            const dirChecks = await Promise.all(
              paths.map((path) => invoke<boolean>('is_directory', { path }))
            );
            const folderCount = dirChecks.filter(Boolean).length;
            setDragContext({
              files: paths.length - folderCount,
              folders: folderCount,
            });
          } catch (err) {
            setDragContext({ files: paths.length, folders: 0 });
          }
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
          setDropRegion(null);
          setDragContext(null);
        } else if (event.payload.type === 'drop') {
          const region = dropRegionRef.current;
          setIsDragging(false);
          setDropRegion(null);

          if (region === 'cancel') return;

          const { paths } = event.payload;
          if (paths.length === 0) return;

          try {
            const dirChecks = await Promise.all(
              paths.map((path) => invoke<boolean>('is_directory', { path })),
            );
            const hasDirectory = dirChecks.some((isDir) => isDir);

            if (region === 'add') {
              const targetDir = activeFolderAbsolutePathRef.current;
              if (targetDir && targetDir.trim().length > 0) {
                try {
                  await invoke('copy_files_to_directory', {
                    sourcePaths: paths,
                    targetDirectory: targetDir,
                  });
                  useStore.getState().updateFolderLastModified(activeFolderPath, 0);
                  await loadImagesForFolderPath(activeFolderPath, { append: false });
                  addToast('Images copied to active folder', 'success');
                } catch (err) {
                  console.error('Failed to copy files:', err);
                  addToast('Failed to copy files to active folder', 'error');
                }
              } else {
                addToast('No active folder selected to copy into', 'error');
              }
            } else if (hasDirectory && region !== 'single' && region !== 'batch') {
              const scan = await invoke<NativeRootScan>('scan_paths', {
                paths,
              });

              if (scan.images.length > 0) {
                // Ensure dropped directories are persisted as roots
                const droppedDirectories = paths.filter((_, index) => dirChecks[index]);
                const newRootNames: string[] = [];

                for (const dirPath of droppedDirectories) {
                  try {
                    await invoke('add_root_path', { rootPath: dirPath });
                    const normalized = dirPath.replace(/\\/g, '/');
                    const parts = normalized.split('/').filter(Boolean);
                    const folderName = parts[parts.length - 1] || normalized;
                    if (folderName) newRootNames.push(folderName);
                  } catch (err) {
                    console.error('Failed to persist dropped root:', dirPath, err);
                  }
                }

                const mapped = scan.images.map(mapNativeToRaw);
                const uniqueRootNames = Array.from(new Set(newRootNames));
                await addImages(mapped, uniqueRootNames.length > 0 ? uniqueRootNames : [scan.root_path]);
              }
            } else {
              const scan = await invoke<NativeRootScan>('scan_paths', {
                paths,
              });

              if (region === 'single' || (scan.images.length === 1 && region !== 'batch')) {
                const mapped = scan.images.map(mapNativeToRaw);
                await setImages(mapped, []);
                setActiveFolderPath(ALL_FOLDERS_VALUE);
                setSingleEditMode(true);
                if (mapped[0]) {
                  setSelectedId(mapped[0].id);
                }
              } else {
                const mapped = scan.images.map(mapNativeToRaw);
                await setImages(mapped, []);
                setActiveFolderPath(ALL_FOLDERS_VALUE);
                setVirtualBatchMode(
                  true,
                  `Dropped Batch (${scan.images.length} images)`,
                );
              }
            }
          } catch (error) {
            console.error('Failed to scan dropped paths:', error);
            addToast('Failed to load dropped items', 'error');
          }
        }
      });
    };

    void setupListeners();

    return () => {
      if (unlistenDragEnter) unlistenDragEnter();
    };
  }, [
    addImages,
    setImages,
    setSingleEditMode,
    setVirtualBatchMode,
    setSelectedId,
    addToast,
  ]);

  const folderName = useMemo(() => {
    if (activeFolderPath && activeFolderPath !== ALL_FOLDERS_VALUE) {
      const normalized = normalizePath(activeFolderPath);
      const root = normalized.split('/').filter(Boolean)[0];
      if (root) return root;
    }
    if (images.length === 0) return '';
    const first = normalizePath(images[0]?.relativePath || '');
    const root = first.split('/').filter(Boolean)[0];
    return root || 'Selected Files';
  }, [activeFolderPath, images]);

  const activeFolderLabel = useMemo(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return 'All Images';
    const parts = activeFolderPath.split('/');
    return parts[parts.length - 1] || activeFolderPath;
  }, [activeFolderPath]);

  const activeFolderAbsolutePath = useMemo(() => {
    if (!activeFolderPath || activeFolderPath === ALL_FOLDERS_VALUE) return '';
    const normalizedFolderPath = normalizePath(activeFolderPath);
    const resolved = resolveRootForFolderPath(normalizedFolderPath);
    if (!resolved) return '';

    const normalizedRootName = normalizePath(resolved.root.rootName);
    const normalizedRootPath = normalizePath(resolved.root.rootPath);
    if (!normalizedRootPath) return '';
    if (!normalizedRootName || normalizedFolderPath === normalizedRootName) {
      return normalizedRootPath;
    }
    if (!normalizedFolderPath.startsWith(`${normalizedRootName}/`)) {
      return normalizedRootPath;
    }

    const folderTail = normalizedFolderPath.slice(normalizedRootName.length + 1);
    if (!folderTail) return normalizedRootPath;
    const rootPathWithoutTrailingSlash = normalizedRootPath.replace(/\/+$/, '');
    return `${rootPathWithoutTrailingSlash}/${folderTail}`;
  }, [activeFolderPath, directoryRootsVersion, resolveRootForFolderPath]);

  useEffect(() => {
    activeFolderAbsolutePathRef.current = activeFolderAbsolutePath;
  }, [activeFolderAbsolutePath]);

  const canOpenActiveFolderPath = useMemo(
    () =>
      activeFolderPath !== ALL_FOLDERS_VALUE &&
      String(activeFolderAbsolutePath || '').trim().length > 0,
    [activeFolderAbsolutePath, activeFolderPath],
  );

  const handleOpenActiveFolder = useCallback(async () => {
    if (!canOpenActiveFolderPath) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    try {
      await invoke('open_folder_in_file_explorer', {
        folderPath: activeFolderAbsolutePath,
      });
    } catch (error) {
      console.error('Failed to open folder in file explorer:', error);
    }
  }, [activeFolderAbsolutePath, canOpenActiveFolderPath]);

  const handleStartFolderSelectModeFromExport = useCallback(() => {
    setExportPlanOpen(false);
    setExplorerOpen(true);
    setExportFolderSelectionMode(true);
  }, []);

  const isActiveFolderLoading = useMemo(() => {
    if (!activeFolderPath || activeFolderPath === ALL_FOLDERS_VALUE) {
      return false;
    }
    return loadingFolderPaths.has(activeFolderPath);
  }, [activeFolderPath, loadingFolderPaths]);


  const handleAddFolder = useCallback(async () => {
    const result = await handlePickFolderViaDirectoryPicker();
    if (!result.handled) {
      addMoreRef.current?.click();
      return;
    }

    const rootPath = normalizePath(result.rootPath);
    const rootName = result.directoryName || getFolderNameFromPath(rootPath);
    if (!rootPath) {
      return;
    }
    const nextHandle = result.directoryHandle;
    const currentRoots = directoryRootsRef.current;

    if (nextHandle || rootPath) {
      let skipByRoot = '';
      const replaceRootPaths: string[] = [];
      const replaceRootNames: string[] = [];

      for (const root of currentRoots) {
        if (root.handle && nextHandle) {
          if (await areSameDirectoryHandles(root.handle, nextHandle)) {
            skipByRoot = root.rootName;
            break;
          }

          if (await isDirectoryAncestor(root.handle, nextHandle)) {
            skipByRoot = root.rootName;
            break;
          }

          if (await isDirectoryAncestor(nextHandle, root.handle)) {
            replaceRootPaths.push(root.rootPath);
            replaceRootNames.push(root.rootName);
          }
        } else if (root.rootPath && rootPath) {
          const existingPath = root.rootPath;
          if (existingPath === rootPath) {
            skipByRoot = root.rootName;
            break;
          }
          if (rootPath.startsWith(`${existingPath}/`)) {
            skipByRoot = root.rootName;
            break;
          }
          if (existingPath.startsWith(`${rootPath}/`)) {
            replaceRootPaths.push(existingPath);
            replaceRootNames.push(root.rootName);
          }
        }
      }

      if (skipByRoot) {
        setActiveFolderPath(skipByRoot);
        return;
      }

      if (replaceRootPaths.length > 0) {
        replaceRootNames.forEach((folderPath) => deleteFolder(folderPath));
        directoryRootsRef.current = currentRoots.filter(
          (root) => !replaceRootPaths.includes(root.rootPath),
        );
        setDirectoryRootsVersion((previous) => previous + 1);
      }
    } else if (
      rootPath &&
      currentRoots.some((root) => root.rootPath === rootPath)
    ) {
      // Native path mode does not provide handle identity; replace by root path.
      deleteFolder(rootPath);
    }

    if (rootPath) {
      directoryRootsRef.current = [
        ...directoryRootsRef.current.filter(
          (root) => root.rootPath !== rootPath,
        ),
        { rootPath, rootName, handle: nextHandle || null },
      ];
      setDirectoryRootsVersion((previous) => previous + 1);
      persistStorageValue(
        LINKED_ROOT_NAMES_STORAGE_KEY,
        JSON.stringify(
          Array.from(
            new Set(
              directoryRootsRef.current
                .map((root) => root.rootName)
                .filter(Boolean),
            ),
          ),
        ),
      );
      saveRootPaths(
        directoryRootsRef.current.map((root) => root.rootPath).filter(Boolean),
      );
    }

    await addImages([], rootName ? [rootName] : []);
    if (rootName) {
      const directKey = `${normalizePath(rootName)}::direct`;
      loadedFolderScanKeysRef.current.delete(directKey);
      folderScanHasMoreRef.current.delete(directKey);
      folderScanNextOffsetRef.current.delete(directKey);
      void loadImagesForFolderPath(rootName);
      setActiveFolderPath(rootName);
      void loadTreeChildrenForPath(rootName);
    }
  }, [
    deleteFolder,
    addImages,
    handlePickFolderViaDirectoryPicker,
    loadImagesForFolderPath,
    loadTreeChildrenForPath,
    setActiveFolderPath,
  ]);

  const handleRemoveFolder = useCallback(
    async (folderPath: string) => {
      const previousRoots = directoryRootsRef.current;
      const removedRoot = previousRoots.find(
        (root) => root.rootName === folderPath || root.rootPath === folderPath,
      );

      deleteFolder(folderPath);
      directoryRootsRef.current = previousRoots.filter(
        (root) => root.rootName !== folderPath && root.rootPath !== folderPath,
      );
      setDirectoryRootsVersion((previous) => previous + 1);

      if (removedRoot?.handle) {
        await clearSavedDirectoryHandleIfMatches(removedRoot.handle);
      } else {
        await removeSavedRootByPath(removedRoot?.rootPath || folderPath);
      }
      markFolderLoading(
        [folderPath, removedRoot?.rootName || '', removedRoot?.rootPath || ''],
        false,
      );
      const removedRootToken = normalizePath(
        removedRoot?.rootName || folderPath,
      );
      loadedFolderScanKeysRef.current = new Set(
        Array.from(loadedFolderScanKeysRef.current).filter((scanKey) => {
          const pathPart = String(scanKey || '').split('::')[0] || '';
          const isFromRemovedRoot =
            pathPart === removedRootToken ||
            pathPart.startsWith(removedRootToken + '/');
          return !isFromRemovedRoot;
        }),
      );
      loadingFolderScanKeysRef.current = new Set(
        Array.from(loadingFolderScanKeysRef.current).filter((scanKey) => {
          const pathPart = String(scanKey || '').split('::')[0] || '';
          const isFromRemovedRoot =
            pathPart === removedRootToken ||
            pathPart.startsWith(removedRootToken + '/');
          return !isFromRemovedRoot;
        }),
      );
      folderScanNextOffsetRef.current = new Map(
        Array.from(folderScanNextOffsetRef.current.entries()).filter(
          ([scanKey]) => {
            const pathPart = String(scanKey || '').split('::')[0] || '';
            const isFromRemovedRoot =
              pathPart === removedRootToken ||
              pathPart.startsWith(removedRootToken + '/');
            return !isFromRemovedRoot;
          },
        ),
      );
      folderScanHasMoreRef.current = new Map(
        Array.from(folderScanHasMoreRef.current.entries()).filter(
          ([scanKey]) => {
            const pathPart = String(scanKey || '').split('::')[0] || '';
            const isFromRemovedRoot =
              pathPart === removedRootToken ||
              pathPart.startsWith(removedRootToken + '/');
            return !isFromRemovedRoot;
          },
        ),
      );
      setTreeFolderNodes((previous) =>
        previous.filter((node) => {
          const normalizedPath = normalizePath(node.path);
          const isFromRemovedRoot =
            normalizedPath === removedRootToken ||
            normalizedPath.startsWith(removedRootToken + '/');
          return !isFromRemovedRoot;
        }),
      );
      loadedTreePathsRef.current = new Set(
        Array.from(loadedTreePathsRef.current).filter((path) => {
          const normalizedPath = normalizePath(path);
          const isFromRemovedRoot =
            normalizedPath === removedRootToken ||
            normalizedPath.startsWith(removedRootToken + '/');
          return !isFromRemovedRoot;
        }),
      );
      loadingTreePathsRef.current = new Set(
        Array.from(loadingTreePathsRef.current).filter((path) => {
          const normalizedPath = normalizePath(path);
          const isFromRemovedRoot =
            normalizedPath === removedRootToken ||
            normalizedPath.startsWith(removedRootToken + '/');
          return !isFromRemovedRoot;
        }),
      );
      setLoadingTreePaths((previous) => {
        const next = new Set<string>();
        previous.forEach((path) => {
          const normalizedPath = normalizePath(path);
          const isFromRemovedRoot =
            normalizedPath === removedRootToken ||
            normalizedPath.startsWith(removedRootToken + '/');
          if (!isFromRemovedRoot) {
            next.add(path);
          }
        });
        return next;
      });
      persistStorageValue(
        LINKED_ROOT_NAMES_STORAGE_KEY,
        JSON.stringify(
          Array.from(
            new Set(
              directoryRootsRef.current
                .map((root) => root.rootName)
                .filter(Boolean),
            ),
          ),
        ),
      );
      saveRootPaths(
        directoryRootsRef.current.map((root) => root.rootPath).filter(Boolean),
      );
      if (directoryRootsRef.current.length === 0) {
        await clearSavedDirectoryHandle();
      }
    },
    [deleteFolder, markFolderLoading],
  );

  const handleClearFolderDrafts = useCallback(
    async (folderPath: string) => {
      const normalizedFolderPath = normalizePath(folderPath);
      if (!normalizedFolderPath || normalizedFolderPath === ALL_FOLDERS_VALUE) {
        return;
      }

      await clearFolderDraft(normalizedFolderPath);
      clearDraftsForFolder(normalizedFolderPath);

      const resolved = resolveRootForFolderPath(normalizedFolderPath);
      if (resolved) {
        loadedDraftPayloadByFolderRef.current.delete(resolved.rootToken);
        loadingDraftPayloadFoldersRef.current.delete(resolved.rootToken);
      }

      const currentImages = useStore.getState().images;
      const imageById = new Map(
        currentImages.map((image) => [image.id, normalizePath(image.relativePath)] as const),
      );
      restoredDraftImageIdsRef.current = new Set(
        Array.from(restoredDraftImageIdsRef.current).filter((id) => {
          const relativePath = imageById.get(id);
          if (!relativePath) return false;
          return !isImageInFolderSubtree(
            relativePath,
            normalizedFolderPath,
          );
        }),
      );
    },
    [clearDraftsForFolder],
  );

  if (
    images.length === 0 &&
    effectiveFolderNodes.length === 0 &&
    !startupRootsResolved
  ) {
    return (
      <div className="app">
        <div className="grid-empty-state">
          <p>Loading linked folders...</p>
        </div>
      </div>
    );
  }

  if (images.length === 0 && effectiveFolderNodes.length === 0) {
    return (
      <div className="app">
        <DropZone onImagesLoaded={handleImagesLoaded} />
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        folderName={folderName}
        sortOption={sortOption}
        sortOrder={sortOrder}
        setSortOption={setSortOption}
        setSortOrder={useStore.getState().setSortOrder}
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((previous) => !previous)}
        activeFolderLabel={activeFolderLabel}
        activeFolderPathOnDisk={activeFolderAbsolutePath}
        canOpenFolderPath={canOpenActiveFolderPath}
        onOpenFolderPath={handleOpenActiveFolder}
        rowHeight={rowHeight}
        setRowHeight={handleRowHeightChange}
        onOpenExportPlan={() => setExportPlanOpen(true)}
        onOpenWatermarkSettings={() => openSettings('engine')}
        inspectorMode={inspectorMode}
        onSetInspectorMode={setInspectorMode}
        showExcluded={showExcluded}
        setShowExcluded={setShowExcluded}
        consideredCount={consideredCount}
        totalCount={totalCount}
        activeFilters={activeFilters}
        toggleFilter={toggleFilter}
        clearFilters={clearFilters}
        onRefreshFolder={activeFolderPath !== ALL_FOLDERS_VALUE ? handleRefreshFolder : undefined}
      />

      <MainLayout
        images={visibleImages}
        excludedById={excludedById}
        rowHeight={rowHeight}
        showAllFooters={showAllFooters}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        handleCropChange={setCropChange}
        handleDelete={handleExcludeSelected}
        handleRestore={handleRestoreExcluded}
        inspectorWidth={inspectorWidth}
        setInspectorWidth={setInspectorWidth}
        explorerWidth={explorerWidth}
        setExplorerWidth={setExplorerWidth}
        selectNext={handleSelectNext}
        selectPrev={handleSelectPrev}
        handleApplyCropToImages={applyCropToImages}
        explorerOpen={explorerOpen}
        folderNodes={effectiveFolderNodes}
        activeFolderPath={activeFolderPath}
        showExcluded={showExcluded}
        onSelectFolder={handleSelectFolder}
        totalImageCount={images.length}
        onResetFolderFilter={() => setActiveFolderPath(ALL_FOLDERS_VALUE)}
        onAddFolder={quickEditMode ? async () => {} : handleAddFolder}
        onRemoveFolder={quickEditMode ? async () => {} : handleRemoveFolder}
        onClearFolderDrafts={
          quickEditMode ? async () => {} : handleClearFolderDrafts
        }
        expandedPaths={expandedPaths}
        onToggleExpand={handleToggleExpand}
        onLoadMoreImages={handleLoadMoreActiveFolder}
        loadingFolderPaths={loadingTreePaths}
        isActiveFolderLoading={isActiveFolderLoading}
        folderSelectionMode={exportFolderSelectionMode}
        selectedFolderPaths={selectedExportFolderPaths}
        onSetFolderSelectionMode={setExportFolderSelectionMode}
        inspectorMode={inspectorMode}
        onSetSelectedFolderPaths={(paths) => {
          const nextSet = new Set(
            Array.from(paths)
              .map((path) => normalizePath(path))
              .filter(Boolean),
          );

          nextSet.forEach((path) => {
            if (!selectedExportFolderPaths.has(path)) {
              void loadTreeChildrenForPath(path);
            }
          });

          setSelectedExportFolderPaths(nextSet);
        }}
        isSingleEditMode={isSingleEditMode}
      />

      <input
        ref={addMoreRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        style={{ display: 'none' }}
        onChange={handleAddMore}
      />

      {exportPlanOpen && (
        <ExportPlanModal
          images={images}
          currentFolderImages={exportableCurrentFolderImages}
          resolveRootForFolderPath={resolveRootForFolderPath}
          selectedFolderPaths={selectedExportFolderPaths}
          excludedById={excludedById}
          folderNodes={effectiveFolderNodes}
          selectedId={selectedId}
          activeFolderLabel={activeFolderLabel}
          activeFolderPathOnDisk={activeFolderAbsolutePath}
          format={format}
          quality={quality}
          cropData={cropData}
          captionById={captionById}
          onEnableFolderSelectionMode={handleStartFolderSelectModeFromExport}
          onClose={() => setExportPlanOpen(false)}
        />
      )}

      {settingsModal.isOpen && (
        <WatermarkSettingsModal
          initialTab={settingsModal.activeTab}
          onClose={closeSettings}
        />
      )}

      <ProcessingOverlay />
      <ToastContainer />
      <CommandPalette />
      <DropOverlay
        isVisible={isDragging}
        onRegionChange={setDropRegion}
        isProjectOpen={images.length > 0}
        dragContext={dragContext}
      />

      <ResizeHandles />

    </div>
  );
};

export default App;
