import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ACCEPTED_IMAGE_TYPES,
  clearSavedDirectoryHandle,
  clearSavedDirectoryHandleIfMatches,
  listDirectoryChildren,
  loadSavedRootPaths,
  removeSavedRootByPath,
  scanImagesFromFolderPath,
} from './utils/directoryPicker';
import { DropZone } from './components/DropZone';
import Toolbar from './components/Toolbar/Toolbar';
import ProgressBar from './components/common/ProgressBar';
import MainLayout from './layouts/MainLayout';
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
import { useExportLogic } from './hooks/useExportLogic';
import type {
  CropEntry,
  DirectoryHandle,
  DirectoryRoot,
  FolderNode,
  GalleryImage,
} from './types/app';
import './App.css';

const EXPLORER_OPEN_STORAGE_KEY = 'bb-explorer-open';
const EXPANDED_PATHS_STORAGE_KEY = 'bb-expanded-paths';
const ACTIVE_FOLDER_STORAGE_KEY = 'bb-active-folder-path';
const LINKED_ROOT_NAMES_STORAGE_KEY = 'bb-linked-root-names';
const ALL_FOLDERS_VALUE = '__all__';
const FOLDER_INITIAL_IMAGE_BATCH = 240;
const FOLDER_LOAD_MORE_BATCH = 180;
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const normalizePath = (value: unknown): string =>
  String(value || '').replace(/\\/g, '/');
const getFolderNameFromPath = (value: unknown): string => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};
const getRootFolderPathFromRelativePath = (relativePath: string): string =>
  normalizePath(relativePath).split('/').filter(Boolean)[0] || '';
const getRootTokenFromPath = (value: string): string =>
  normalizePath(value).split('/').filter(Boolean)[0] || '';
const isDirectImageChildOfFolder = (
  relativePath: string,
  folderPath: string,
): boolean => {
  const normalizedRelativePath = normalizePath(relativePath);
  const normalizedFolderPath = normalizePath(folderPath);
  if (!normalizedRelativePath || !normalizedFolderPath) return false;
  if (!normalizedRelativePath.startsWith(`${normalizedFolderPath}/`)) {
    return false;
  }
  const remainder = normalizedRelativePath.slice(normalizedFolderPath.length + 1);
  return remainder.length > 0 && !remainder.includes('/');
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

function App() {
  const images = useStore((state) => state.images);
  const rowHeight = useStore((state) => state.rowHeight);
  const showAllFooters = useStore((state) => state.showAllFooters);
  const selectedId = useStore((state) => state.selectedId);
  const inspectorWidth = useStore((state) => state.inspectorWidth);
  const setSelectedId = useStore((state) => state.setSelectedId);
  const setCropChange = useStore((state) => state.setCropChange);
  const applyCropToImages = useStore((state) => state.applyCropToImages);
  const setRowHeight = useStore((state) => state.setRowHeight);
  const setInspectorWidth = useStore((state) => state.setInspectorWidth);
  const explorerWidth = useStore((state) => state.explorerWidth);
  const setExplorerWidth = useStore((state) => state.setExplorerWidth);
  const sortOption = useStore((state) => state.sortOption);
  const setSortOption = useStore((state) => state.setSortOption);
  const applyPersistedImageDrafts = useStore(
    (state) => state.applyPersistedImageDrafts,
  );
  const clearDraftsForFolder = useStore((state) => state.clearDraftsForFolder);
  const deleteFolder = useStore((state) => state.deleteFolder);
  const processing = useStore((state) => state.processing);
  const folderNodes = useStore((state) => state.folderNodes);
  const rootNames = useStore((state) => state.rootNames);
  const addImages = useStore((state) => state.addImages);
  const expandedPaths = useStore((state) => state.expandedPaths);
  const toggleExpandedPath = useStore((state) => state.toggleExpandedPath);
  const setExpandedPaths = useStore((state) => state.setExpandedPaths);

  const addMoreRef = useRef<HTMLInputElement | null>(null);
  const {
    handleImagesLoaded,
    handleAddMore,
    handlePickFolderViaDirectoryPicker,
  } = useImageUpload();
  const { handleExport } = useExportLogic();
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
  const [startupRootsResolved, setStartupRootsResolved] = useState(false);
  const [loadingFolderPaths, setLoadingFolderPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [treeFolderNodes, setTreeFolderNodes] = useState<FolderNode[]>([]);
  const [loadingTreePaths, setLoadingTreePaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [directoryRootsVersion, setDirectoryRootsVersion] = useState(0);
  const loadedTreePathsRef = useRef<Set<string>>(new Set());
  const loadingTreePathsRef = useRef<Set<string>>(new Set());

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
      pendingRowHeightRef.current = nextValue;
      if (rowHeightRafRef.current) return;
      rowHeightRafRef.current = requestAnimationFrame(() => {
        rowHeightRafRef.current = 0;
        setRowHeight(pendingRowHeightRef.current);
      });
    },
    [setRowHeight],
  );

  useEffect(() => {
    pendingRowHeightRef.current = rowHeight;
  }, [rowHeight]);

  useEffect(() => {
    if (images.length !== 0) return;
    restoredDraftImageIdsRef.current = new Set();
    loadedDraftPayloadByFolderRef.current = new Map();
    loadingDraftPayloadFoldersRef.current = new Set();
  }, [images.length]);

  useEffect(() => {
    if (cachedRootNamesBootstrappedRef.current) return;
    if (images.length > 0 || folderNodes.length > 0) return;
    cachedRootNamesBootstrappedRef.current = true;

    const cachedRootNames = Array.from(
      new Set(readStoredStringArray(LINKED_ROOT_NAMES_STORAGE_KEY)),
    );
    if (cachedRootNames.length > 0) {
      addImages([], cachedRootNames);
    }
  }, [addImages, folderNodes.length, images.length]);

  useEffect(() => {
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
  }, [addImages, images.length]);

  useEffect(() => {
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
  }, [setExpandedPaths]);

  useEffect(() => {
    window.localStorage.setItem(
      EXPANDED_PATHS_STORAGE_KEY,
      JSON.stringify(Array.from(expandedPaths)),
    );
  }, [expandedPaths]);

  const mergeTreeNodes = useCallback(
    (nextNodes: FolderNode[], options: { pruneToRoots?: string[] } = {}) => {
      setTreeFolderNodes((previous) => {
        const byPath = new Map<string, FolderNode>();
        const allowedRoots = options.pruneToRoots
          ? new Set(options.pruneToRoots)
          : null;

        previous.forEach((node) => {
          const rootPath = normalizePath(node.path).split('/').filter(Boolean)[0] || '';
          if (allowedRoots && rootPath && !allowedRoots.has(rootPath)) return;
          byPath.set(node.path, node);
        });

        nextNodes.forEach((node) => {
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
    const rootToken = normalized.split('/').filter(Boolean)[0] || normalized;
    if (!rootToken) return null;

    const root = directoryRootsRef.current.find(
      (candidate) =>
        candidate.rootName === rootToken || candidate.rootPath === rootToken,
    );
    if (!root?.rootPath || !root.rootName) return null;
    return {
      root,
      rootToken,
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
              name:
                normalizedFolderPath.split('/').filter(Boolean).pop() ||
                normalizedFolderPath,
              depth:
                normalizedFolderPath
                  .split('/')
                  .filter(Boolean)
                  .length - 1,
              count: 0,
              expandable: children.length > 0,
            },
            ...children,
          ],
        );
        loadedTreePathsRef.current.add(normalizedFolderPath);
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
        : linkedRootNamesFromPaths.length > 0
          ? linkedRootNamesFromPaths
          : cachedLinkedRootNames;
    return Array.from(new Set(source.filter(Boolean)));
  }, [cachedLinkedRootNames, linkedRootNamesFromPaths, rootNames]);

  useEffect(() => {
    const uniqueRoots = Array.from(new Set(effectiveRootNames.filter(Boolean)));
    const allowedRoots = new Set(uniqueRoots);
    const getScanKeyRootToken = (scanKey: string): string => {
      const pathPart = String(scanKey || '').split('::')[0] || '';
      return getRootTokenFromPath(pathPart);
    };

    loadedTreePathsRef.current = new Set(
      Array.from(loadedTreePathsRef.current).filter((path) => {
        const root = getRootTokenFromPath(path);
        return root ? allowedRoots.has(root) : false;
      }),
    );
    loadingTreePathsRef.current = new Set(
      Array.from(loadingTreePathsRef.current).filter((path) => {
        const root = getRootTokenFromPath(path);
        return root ? allowedRoots.has(root) : false;
      }),
    );
    loadedFolderScanKeysRef.current = new Set(
      Array.from(loadedFolderScanKeysRef.current).filter((scanKey) => {
        const root = getScanKeyRootToken(scanKey);
        return root ? allowedRoots.has(root) : false;
      }),
    );
    loadingFolderScanKeysRef.current = new Set(
      Array.from(loadingFolderScanKeysRef.current).filter((scanKey) => {
        const root = getScanKeyRootToken(scanKey);
        return root ? allowedRoots.has(root) : false;
      }),
    );
    folderScanNextOffsetRef.current = new Map(
      Array.from(folderScanNextOffsetRef.current.entries()).filter(
        ([scanKey]) => {
          const root = getScanKeyRootToken(scanKey);
          return root ? allowedRoots.has(root) : false;
        },
      ),
    );
    folderScanHasMoreRef.current = new Map(
      Array.from(folderScanHasMoreRef.current.entries()).filter(([scanKey]) => {
        const root = getScanKeyRootToken(scanKey);
        return root ? allowedRoots.has(root) : false;
      }),
    );

    const rootNodes: FolderNode[] = uniqueRoots.map((name) => ({
      path: name,
      name,
      depth: 0,
      count: 0,
      expandable: true,
    }));
    mergeTreeNodes(rootNodes, { pruneToRoots: uniqueRoots });

    setLoadingTreePaths((previous) => {
      const next = new Set<string>();
      previous.forEach((path) => {
        const root = getRootTokenFromPath(path);
        if (root && allowedRoots.has(root)) {
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
    const countsByPath = new Map<string, number>();
    folderNodes.forEach((node) => {
      countsByPath.set(normalizePath(node.path), Math.max(0, node.count || 0));
    });

    if (treeFolderNodes.length > 0) {
      return treeFolderNodes.map((node) => ({
        ...node,
        count: countsByPath.get(normalizePath(node.path)) ?? node.count,
      }));
    }

    return effectiveRootNames.map((name) => ({
      path: name,
      name,
      depth: 0,
      count: countsByPath.get(normalizePath(name)) ?? 0,
      expandable: true,
    }));
  }, [effectiveRootNames, folderNodes, treeFolderNodes]);

  useEffect(() => {
    if (images.length !== 0) return;
    if (folderNodes.length !== 0) return;
    const rootNames = directoryRootsRef.current
      .map((root) => root.rootName)
      .filter(Boolean);
    if (rootNames.length === 0) return;
    addImages([], Array.from(new Set(rootNames)));
  }, [addImages, folderNodes.length, images.length]);

  const filteredImages = useMemo(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) {
      return images.filter((image) => {
        const relativePath = normalizePath(image.relativePath);
        const parts = relativePath.split('/').filter(Boolean);
        return parts.length <= 2;
      });
    }
    const prefix = `${activeFolderPath}/`;
    return images.filter((image) => {
      const relativePath = normalizePath(image.relativePath);
      if (!relativePath.startsWith(prefix)) return false;
      const remainder = relativePath.substring(prefix.length);
      return !remainder.includes('/');
    });
  }, [activeFolderPath, images]);

  const visibleImages = useMemo(() => {
    const next = filteredImages.map((image, originalIndex) => ({
      image,
      originalIndex,
    }));

    next.sort((entryA, entryB) => {
      const a = entryA.image;
      const b = entryB.image;

      if (sortOption === 'name_asc') {
        const byName = nameCollator.compare(a.name || '', b.name || '');
        if (byName !== 0) return byName;
      } else if (sortOption === 'name_desc') {
        const byName = nameCollator.compare(b.name || '', a.name || '');
        if (byName !== 0) return byName;
      } else if (sortOption === 'size_desc') {
        const bySize = (b.sourceSize || 0) - (a.sourceSize || 0);
        if (bySize !== 0) return bySize;
      } else if (sortOption === 'size_asc') {
        const bySize = (a.sourceSize || 0) - (b.sourceSize || 0);
        if (bySize !== 0) return bySize;
      } else if (
        sortOption === 'last_modified_oldest' ||
        sortOption === 'last_modified'
      ) {
        // Read the current modification times directly.
        // We do *not* subscribe to sessionModifiedAt in App.tsx because it
        // causes the entire gallery to re-render synchronously 60x a second
        // when dragging padding/rotation sliders.
        const currentModTimes = useStore.getState().sessionModifiedAt;

        const byModifiedA = getEffectiveModifiedTimestamp(a, currentModTimes);
        const byModifiedB = getEffectiveModifiedTimestamp(b, currentModTimes);

        if (sortOption === 'last_modified_oldest') {
          const byModified = byModifiedA - byModifiedB;
          if (byModified !== 0) return byModified;
        } else {
          const byModified = byModifiedB - byModifiedA;
          if (byModified !== 0) return byModified;
        }
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
  }, [filteredImages, sortOption]); // Deliberately omitting sessionModifiedAt to avoid lag

  const visibleImageIds = useMemo(
    () => new Set(visibleImages.map((image) => image.id)),
    [visibleImages],
  );

  const handleSelectNext = useCallback(() => {
    if (!selectedId) return;
    const index = visibleImages.findIndex((image) => image.id === selectedId);
    if (index < 0 || index >= visibleImages.length - 1) return;
    setSelectedId(visibleImages[index + 1].id);
  }, [selectedId, setSelectedId, visibleImages]);

  const handleSelectPrev = useCallback(() => {
    if (!selectedId) return;
    const index = visibleImages.findIndex((image) => image.id === selectedId);
    if (index <= 0) return;
    setSelectedId(visibleImages[index - 1].id);
  }, [selectedId, setSelectedId, visibleImages]);

  const loadImagesForFolderPath = useCallback(
    async (
      folderPath: string,
      options: { append?: boolean } = {},
    ) => {
      const append = Boolean(options.append);
      const normalizedFolderPath = normalizePath(folderPath);
      if (
        !normalizedFolderPath ||
        normalizedFolderPath === ALL_FOLDERS_VALUE
      ) {
        return;
      }

      const resolved = resolveRootForFolderPath(normalizedFolderPath);
      if (!resolved) return;

      const { root, rootToken } = resolved;
      const scanKey = `${normalizedFolderPath}::direct`;
      if (!append && loadedFolderScanKeysRef.current.has(scanKey)) return;
      if (append && folderScanHasMoreRef.current.get(scanKey) === false) return;
      if (loadingFolderScanKeysRef.current.has(scanKey)) return;

      const offset = append
        ? Math.max(0, folderScanNextOffsetRef.current.get(scanKey) || 0)
        : 0;
      const limit = append
        ? FOLDER_LOAD_MORE_BATCH
        : FOLDER_INITIAL_IMAGE_BATCH;

      loadingFolderScanKeysRef.current.add(scanKey);
      const loadingKeys = Array.from(
        new Set([
          normalizedFolderPath,
          rootToken,
          root.rootName,
          root.rootPath,
        ]),
      ).filter(Boolean);
      markFolderLoading(loadingKeys, true);
      try {
        const scanResult = await scanImagesFromFolderPath({
          rootPath: root.rootPath,
          rootName: root.rootName,
          folderPath: normalizedFolderPath,
          offset,
          limit,
        });
        await addImages(scanResult.images, [root.rootName]);
        loadedFolderScanKeysRef.current.add(scanKey);
        const nextOffset = offset + (Array.isArray(scanResult.images) ? scanResult.images.length : 0);
        folderScanNextOffsetRef.current.set(scanKey, nextOffset);
        const hasMore = Array.isArray(scanResult.images)
          ? scanResult.images.length >= limit
          : false;
        folderScanHasMoreRef.current.set(scanKey, hasMore);
      } finally {
        loadingFolderScanKeysRef.current.delete(scanKey);
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
    persistStorageValue(EXPLORER_OPEN_STORAGE_KEY, explorerOpen ? '1' : '0');
  }, [explorerOpen]);

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
    expandedPaths.forEach((path) => {
      if (!path || path === ALL_FOLDERS_VALUE) return;
      void loadTreeChildrenForPath(path);
    });
  }, [expandedPaths, loadTreeChildrenForPath]);

  useEffect(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return;
    const pathExists = effectiveFolderNodes.some(
      (folder) => folder.path === activeFolderPath,
    );
    if (!pathExists) {
      const activeRootPath =
        normalizePath(activeFolderPath).split('/').filter(Boolean)[0] || '';
      if (activeRootPath && effectiveRootNames.includes(activeRootPath)) {
        return;
      }
      setActiveFolderPath(ALL_FOLDERS_VALUE);
    }
  }, [activeFolderPath, effectiveFolderNodes, effectiveRootNames]);

  useEffect(() => {
    persistStorageValue(ACTIVE_FOLDER_STORAGE_KEY, activeFolderPath);
  }, [activeFolderPath]);

  useEffect(() => {
    if (!selectedId) return;
    if (visibleImageIds.has(selectedId)) return;
    setSelectedId(null);
  }, [selectedId, setSelectedId, visibleImageIds]);

  useEffect(
    () => () => {
      if (!draftPersistTimerRef.current) return;
      window.clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = 0;
    },
    [],
  );

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const flushDraftPersistence = () => {
      const state = useStore.getState();
      if (!Array.isArray(state.images) || state.images.length === 0) return;
      persistFolderDrafts({
        images: state.images,
        cropData: state.cropData,
        captionById: state.captionById,
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
  }, []);

  useEffect(() => {
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
      const modifiedAtById: Record<string, number> = {};

      applyIds.forEach((id) => {
        const crop = resolvedDrafts.cropEntriesById[id];
        if (crop) {
          cropEntriesById[id] = crop;
        }
        if (Object.prototype.hasOwnProperty.call(resolvedDrafts.captionsById, id)) {
          captionsById[id] = resolvedDrafts.captionsById[id];
        }
        const ts = Number(resolvedDrafts.modifiedAtById[id] || 0);
        if (ts > 0) {
          modifiedAtById[id] = ts;
        }
      });

      if (
        Object.keys(cropEntriesById).length === 0 &&
        Object.keys(captionsById).length === 0
      ) {
        return;
      }

      applyPersistedImageDrafts({
        cropEntriesById,
        captionsById,
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
  }, [applyPersistedImageDrafts, images, loadedRootPaths]);

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

  const folderName = useMemo(() => {
    if (images.length === 0) return '';
    const first = images[0]?.relativePath || '';
    const parts = first.split('/');
    return parts.length > 1 ? parts[0] : 'Selected Files';
  }, [images]);

  const activeFolderLabel = useMemo(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return 'All Images';
    const parts = activeFolderPath.split('/');
    return parts[parts.length - 1] || activeFolderPath;
  }, [activeFolderPath]);

  const isActiveFolderLoading = useMemo(() => {
    if (!activeFolderPath || activeFolderPath === ALL_FOLDERS_VALUE) {
      return false;
    }
    return loadingFolderPaths.has(activeFolderPath);
  }, [activeFolderPath, loadingFolderPaths]);

  const explorerLoadingFolderPaths = useMemo(
    () => new Set([...loadingFolderPaths, ...loadingTreePaths]),
    [loadingFolderPaths, loadingTreePaths],
  );

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
          const rootToken = getRootTokenFromPath(pathPart);
          return rootToken !== removedRootToken;
        }),
      );
      loadingFolderScanKeysRef.current = new Set(
        Array.from(loadingFolderScanKeysRef.current).filter((scanKey) => {
          const pathPart = String(scanKey || '').split('::')[0] || '';
          const rootToken = getRootTokenFromPath(pathPart);
          return rootToken !== removedRootToken;
        }),
      );
      folderScanNextOffsetRef.current = new Map(
        Array.from(folderScanNextOffsetRef.current.entries()).filter(
          ([scanKey]) => {
            const pathPart = String(scanKey || '').split('::')[0] || '';
            const rootToken = getRootTokenFromPath(pathPart);
            return rootToken !== removedRootToken;
          },
        ),
      );
      folderScanHasMoreRef.current = new Map(
        Array.from(folderScanHasMoreRef.current.entries()).filter(
          ([scanKey]) => {
            const pathPart = String(scanKey || '').split('::')[0] || '';
            const rootToken = getRootTokenFromPath(pathPart);
            return rootToken !== removedRootToken;
          },
        ),
      );
      setTreeFolderNodes((previous) =>
        previous.filter((node) => {
          const rootToken = getRootTokenFromPath(node.path);
          return rootToken !== removedRootToken;
        }),
      );
      loadedTreePathsRef.current = new Set(
        Array.from(loadedTreePathsRef.current).filter((path) => {
          const rootToken = getRootTokenFromPath(path);
          return rootToken !== removedRootToken;
        }),
      );
      loadingTreePathsRef.current = new Set(
        Array.from(loadingTreePathsRef.current).filter((path) => {
          const rootToken = getRootTokenFromPath(path);
          return rootToken !== removedRootToken;
        }),
      );
      setLoadingTreePaths((previous) => {
        const next = new Set<string>();
        previous.forEach((path) => {
          const rootToken = getRootTokenFromPath(path);
          if (rootToken !== removedRootToken) {
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

      const rootToken = getRootTokenFromPath(normalizedFolderPath);
      if (rootToken) {
        loadedDraftPayloadByFolderRef.current.delete(rootToken);
        loadingDraftPayloadFoldersRef.current.delete(rootToken);
      }

      const currentImages = useStore.getState().images;
      const imageById = new Map(
        currentImages.map((image) => [image.id, normalizePath(image.relativePath)] as const),
      );
      restoredDraftImageIdsRef.current = new Set(
        Array.from(restoredDraftImageIdsRef.current).filter((id) => {
          const relativePath = imageById.get(id);
          if (!relativePath) return false;
          return !isDirectImageChildOfFolder(
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
        setSortOption={setSortOption}
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((previous) => !previous)}
        activeFolderLabel={activeFolderLabel}
        rowHeight={rowHeight}
        setRowHeight={handleRowHeightChange}
        onExport={handleExport}
        processing={processing}
      />

      <ProgressBar current={processing?.current} total={processing?.total} />

      <MainLayout
        images={visibleImages}
        rowHeight={rowHeight}
        showAllFooters={showAllFooters}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        handleCropChange={setCropChange}
        handleDelete={(id) => useStore.getState().deleteImage(id)}
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
        onSelectFolder={handleSelectFolder}
        totalImageCount={images.length}
        onResetFolderFilter={() => setActiveFolderPath(ALL_FOLDERS_VALUE)}
        onAddFolder={handleAddFolder}
        onRemoveFolder={handleRemoveFolder}
        onClearFolderDrafts={handleClearFolderDrafts}
        expandedPaths={expandedPaths}
        onToggleExpand={handleToggleExpand}
        onLoadMoreImages={handleLoadMoreActiveFolder}
        loadingFolderPaths={explorerLoadingFolderPaths}
        isActiveFolderLoading={isActiveFolderLoading}
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
    </div>
  );
}

export default App;
