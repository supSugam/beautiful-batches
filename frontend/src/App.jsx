import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropZone } from './components/DropZone';
import Toolbar from './components/Toolbar/Toolbar';
import ProgressBar from './components/common/ProgressBar';
import MainLayout from './layouts/MainLayout';
import useStore from './store/useStore';
import { useImageUpload } from './hooks/useImageUpload';
import { useExportLogic } from './hooks/useExportLogic';
import {
  ACCEPTED_IMAGE_TYPES,
  clearSavedDirectoryHandle,
  clearSavedDirectoryHandleIfMatches,
} from './utils/directoryPicker';
import {
  loadFolderDraftPayloads,
  loadFolderDraftSummaries,
  persistFolderDrafts,
  resolveDraftsForImages,
} from './utils/editDraftPersistence';
import './App.css';

const EXPLORER_OPEN_STORAGE_KEY = 'bb-explorer-open';
const ACTIVE_FOLDER_STORAGE_KEY = 'bb-active-folder-path';
const ALL_FOLDERS_VALUE = '__all__';
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const getRootFolderPathFromRelativePath = (relativePath) =>
  normalizePath(relativePath).split('/').filter(Boolean)[0] || '';

const readStoredBoolean = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === '1';
};

const readStoredString = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) ?? fallback;
};

const persistStorageValue = (key, value) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
};

const buildFolderNodes = (images) => {
  const folders = new Map();

  images.forEach((image) => {
    const relativePath = normalizePath(image?.relativePath);
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length < 2) return;

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

const getRootFolderPathFromResult = (result) => {
  const fromName = normalizePath(result?.directoryName || '');
  if (fromName) return fromName;

  const firstPath = normalizePath(result?.images?.[0]?.relativePath || '');
  const firstPart = firstPath.split('/').filter(Boolean)[0];
  return firstPart || '';
};

const areSameDirectoryHandles = async (a, b) => {
  if (!a || !b || typeof a.isSameEntry !== 'function') return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
};

const isDirectoryAncestor = async (ancestor, descendant) => {
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

const getEffectiveModifiedTimestamp = (image, sessionModifiedAt) => {
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
  const sortOption = useStore((state) => state.sortOption);
  const setSortOption = useStore((state) => state.setSortOption);
  const sessionModifiedAt = useStore((state) => state.sessionModifiedAt);
  const applyPersistedImageDrafts = useStore(
    (state) => state.applyPersistedImageDrafts,
  );
  const deleteFolder = useStore((state) => state.deleteFolder);
  const processing = useStore((state) => state.processing);

  const addMoreRef = useRef(null);
  const {
    handleImagesLoaded,
    handleAddMore,
    handlePickFolderViaDirectoryPicker,
    restoreLastDirectoryIfAvailable,
  } = useImageUpload();
  const { handleExport } = useExportLogic();
  const restoreAttemptedRef = useRef(false);
  const rowHeightRafRef = useRef(0);
  const pendingRowHeightRef = useRef(rowHeight);
  const directoryRootsRef = useRef([]);
  const draftPersistTimerRef = useRef(0);
  const resolvedDraftFoldersRef = useRef(new Set());
  const [explorerOpen, setExplorerOpen] = useState(() =>
    readStoredBoolean(EXPLORER_OPEN_STORAGE_KEY, true),
  );
  const [activeFolderPath, setActiveFolderPath] = useState(() =>
    readStoredString(ACTIVE_FOLDER_STORAGE_KEY, ALL_FOLDERS_VALUE),
  );
  const [draftRestorePrompt, setDraftRestorePrompt] = useState(null);

  const handleRowHeightChange = useCallback(
    (nextValue) => {
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
    directoryRootsRef.current = [];
    resolvedDraftFoldersRef.current = new Set();
    setDraftRestorePrompt(null);
  }, [images.length]);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (images.length > 0) return;
    restoreAttemptedRef.current = true;

    restoreLastDirectoryIfAvailable().then((result) => {
      if (!result?.restored) return;
      const restoredRoot = getRootFolderPathFromResult(result);
      if (result.directoryHandle && restoredRoot) {
        directoryRootsRef.current = [
          { rootPath: restoredRoot, handle: result.directoryHandle },
        ];
      }
      if (restoredRoot) {
        setActiveFolderPath(restoredRoot);
      }
    });
  }, [images.length, restoreLastDirectoryIfAvailable, setActiveFolderPath]);

  useEffect(
    () => () => {
      if (!rowHeightRafRef.current) return;
      cancelAnimationFrame(rowHeightRafRef.current);
      rowHeightRafRef.current = 0;
    },
    [],
  );

  const folderNodes = useMemo(() => buildFolderNodes(images), [images]);
  const loadedRootPaths = useMemo(() => {
    const roots = new Set();
    images.forEach((image) => {
      const root = getRootFolderPathFromRelativePath(image?.relativePath);
      if (root) roots.add(root);
    });
    return Array.from(roots);
  }, [images]);

  const filteredImages = useMemo(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return images;
    const prefix = `${activeFolderPath}/`;
    return images.filter((image) =>
      normalizePath(image.relativePath).startsWith(prefix),
    );
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
      } else if (sortOption === 'last_modified_oldest') {
        const byModified =
          getEffectiveModifiedTimestamp(a, sessionModifiedAt) -
          getEffectiveModifiedTimestamp(b, sessionModifiedAt);
        if (byModified !== 0) return byModified;
      } else {
        const byModified =
          getEffectiveModifiedTimestamp(b, sessionModifiedAt) -
          getEffectiveModifiedTimestamp(a, sessionModifiedAt);
        if (byModified !== 0) return byModified;
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
  }, [filteredImages, sessionModifiedAt, sortOption]);

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

  useEffect(() => {
    persistStorageValue(
      EXPLORER_OPEN_STORAGE_KEY,
      explorerOpen ? '1' : '0',
    );
  }, [explorerOpen]);

  useEffect(() => {
    if (activeFolderPath === ALL_FOLDERS_VALUE) return;
    const pathExists = folderNodes.some((folder) => folder.path === activeFolderPath);
    if (!pathExists) {
      setActiveFolderPath(ALL_FOLDERS_VALUE);
    }
  }, [activeFolderPath, folderNodes]);

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
      setDraftRestorePrompt(null);
      return () => {
        cancelled = true;
      };
    }

    if (sessionModifiedAt.size > 0) {
      images.forEach((image) => {
        if (!sessionModifiedAt.has(image.id)) return;
        const root = getRootFolderPathFromRelativePath(image.relativePath);
        if (root) {
          resolvedDraftFoldersRef.current.add(root);
        }
      });
    }

    const unresolvedFolders = loadedRootPaths.filter(
      (folderPath) => !resolvedDraftFoldersRef.current.has(folderPath),
    );
    if (unresolvedFolders.length === 0) {
      setDraftRestorePrompt(null);
      return () => {
        cancelled = true;
      };
    }

    loadFolderDraftSummaries(unresolvedFolders).then((summaries) => {
      if (cancelled) return;
      const items = summaries
        .filter((item) => item.count > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((item) => ({
          ...item,
          selected: true,
        }));

      if (items.length === 0) {
        setDraftRestorePrompt(null);
        return;
      }

      setDraftRestorePrompt((previous) => {
        if (!previous?.items?.length) {
          return { items };
        }

        const selectedByFolder = new Map(
          previous.items.map((item) => [item.folderPath, item.selected]),
        );
        return {
          items: items.map((item) => ({
            ...item,
            selected: selectedByFolder.has(item.folderPath)
              ? selectedByFolder.get(item.folderPath)
              : item.selected,
          })),
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [images, loadedRootPaths, sessionModifiedAt]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (String(event.key || '').toLowerCase() !== 'b') return;

      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
        return;
      }

      event.preventDefault();
      setExplorerOpen((previous) => !previous);
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

  const handleAddFolder = useCallback(async () => {
    const result = await handlePickFolderViaDirectoryPicker();
    if (!result.handled) {
      addMoreRef.current?.click();
      return;
    }
    if (!Array.isArray(result.images) || result.images.length === 0) {
      return;
    }

    const rootPath = getRootFolderPathFromResult(result);
    const nextHandle = result.directoryHandle;

    if (nextHandle) {
      const currentRoots = directoryRootsRef.current;
      let skipByRoot = '';
      const replaceRoots = [];

      for (const root of currentRoots) {
        if (!root?.handle) continue;

        if (await areSameDirectoryHandles(root.handle, nextHandle)) {
          skipByRoot = root.rootPath;
          break;
        }

        if (await isDirectoryAncestor(root.handle, nextHandle)) {
          skipByRoot = root.rootPath;
          break;
        }

        if (await isDirectoryAncestor(nextHandle, root.handle)) {
          replaceRoots.push(root.rootPath);
        }
      }

      if (skipByRoot) {
        setActiveFolderPath(skipByRoot);
        return;
      }

      if (replaceRoots.length > 0) {
        replaceRoots.forEach((folderPath) => deleteFolder(folderPath));
        directoryRootsRef.current = currentRoots.filter(
          (root) => !replaceRoots.includes(root.rootPath),
        );
      }

      if (rootPath) {
        directoryRootsRef.current = [
          ...directoryRootsRef.current.filter((root) => root.rootPath !== rootPath),
          { rootPath, handle: nextHandle },
        ];
      }
    }

    await handleImagesLoaded(result.images);
    if (rootPath) {
      setActiveFolderPath(rootPath);
    }
  }, [
    deleteFolder,
    handleImagesLoaded,
    handlePickFolderViaDirectoryPicker,
    setActiveFolderPath,
  ]);

  const handleRemoveFolder = useCallback(
    async (folderPath) => {
      const previousRoots = directoryRootsRef.current;
      const removedRoot = previousRoots.find((root) => root.rootPath === folderPath);

      deleteFolder(folderPath);
      directoryRootsRef.current = previousRoots.filter(
        (root) => root.rootPath !== folderPath,
      );

      if (removedRoot?.handle) {
        await clearSavedDirectoryHandleIfMatches(removedRoot.handle);
      }
      if (directoryRootsRef.current.length === 0) {
        await clearSavedDirectoryHandle();
      }
    },
    [deleteFolder],
  );

  const handleToggleDraftFolderSelection = useCallback((folderPath) => {
    setDraftRestorePrompt((previous) => {
      if (!previous?.items?.length) return previous;
      return {
        items: previous.items.map((item) =>
          item.folderPath === folderPath
            ? { ...item, selected: !item.selected }
            : item,
        ),
      };
    });
  }, []);

  const handleSkipDraftRestore = useCallback(() => {
    if (!draftRestorePrompt?.items?.length) return;
    draftRestorePrompt.items.forEach((item) =>
      resolvedDraftFoldersRef.current.add(item.folderPath),
    );
    setDraftRestorePrompt(null);
  }, [draftRestorePrompt]);

  const handleApplyDraftRestore = useCallback(async () => {
    if (!draftRestorePrompt?.items?.length) return;

    const selectedFolders = draftRestorePrompt.items
      .filter((item) => item.selected)
      .map((item) => item.folderPath);
    if (selectedFolders.length === 0) return;

    const folderDraftPayloads = await loadFolderDraftPayloads(selectedFolders);
    const resolvedDrafts = resolveDraftsForImages({
      images,
      folderDraftPayloads,
    });

    const hasRestorableData =
      Object.keys(resolvedDrafts.cropEntriesById).length > 0 ||
      Object.keys(resolvedDrafts.captionsById).length > 0;
    if (hasRestorableData) {
      applyPersistedImageDrafts(resolvedDrafts);
    }

    draftRestorePrompt.items.forEach((item) =>
      resolvedDraftFoldersRef.current.add(item.folderPath),
    );
    setDraftRestorePrompt(null);
  }, [applyPersistedImageDrafts, draftRestorePrompt, images]);

  if (images.length === 0) {
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

      {draftRestorePrompt?.items?.length > 0 && (
        <div className="draft-restore-banner" role="status">
          <div className="draft-restore-heading">
            Found saved image drafts for these folders
          </div>
          <div className="draft-restore-list">
            {draftRestorePrompt.items.map((item) => (
              <label key={item.folderPath} className="draft-restore-item">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() =>
                    handleToggleDraftFolderSelection(item.folderPath)
                  }
                />
                <span className="draft-restore-folder">{item.folderPath}</span>
                <span className="draft-restore-count">{item.count}</span>
                <span className="draft-restore-date">
                  {item.updatedAt
                    ? new Date(item.updatedAt).toLocaleString()
                    : 'Unknown'}
                </span>
              </label>
            ))}
          </div>
          <div className="draft-restore-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSkipDraftRestore}
            >
              Skip for now
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleApplyDraftRestore}
              disabled={!draftRestorePrompt.items.some((item) => item.selected)}
            >
              Restore selected
            </button>
          </div>
        </div>
      )}

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
        selectNext={handleSelectNext}
        selectPrev={handleSelectPrev}
        handleApplyCropToImages={applyCropToImages}
        explorerOpen={explorerOpen}
        folderNodes={folderNodes}
        activeFolderPath={activeFolderPath}
        onSelectFolder={setActiveFolderPath}
        totalImageCount={images.length}
        onResetFolderFilter={() => setActiveFolderPath(ALL_FOLDERS_VALUE)}
        onAddFolder={handleAddFolder}
        onRemoveFolder={handleRemoveFolder}
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
