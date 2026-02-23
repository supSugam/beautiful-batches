import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { FolderNode } from '../types/app';
import { useSidebarResize } from './Inspector/hooks/useSidebarResize';
import useStore from '../store/useStore';
import TriStateCheckbox, { type TriState } from './common/TriStateCheckbox';
import './FolderExplorer.css';

const ALL_FOLDERS_VALUE = '__all__';
const normalizePath = (value: unknown): string =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');

const getDirectParentFolderPath = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '';
  return normalized.slice(0, lastSlash);
};

const getAncestorPaths = (path: string): string[] => {
  const ancestors: string[] = [];
  let cursor = normalizePath(path);
  let lastSlash = cursor.lastIndexOf('/');

  while (lastSlash > 0) {
    cursor = cursor.slice(0, lastSlash);
    ancestors.push(cursor);
    lastSlash = cursor.lastIndexOf('/');
  }

  return ancestors;
};

const areSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

const hasPathPrefix = (value: string, prefix: string): boolean =>
  value === prefix || value.startsWith(`${prefix}/`);

const hasSelectedAncestor = (path: string, selectedPaths: Set<string>): boolean => {
  const ancestors = getAncestorPaths(path);
  return ancestors.some((ancestorPath) => selectedPaths.has(ancestorPath));
};

const isPathCoveredBySelection = (
  path: string,
  selectedPaths: Set<string>,
): boolean => selectedPaths.has(path) || hasSelectedAncestor(path, selectedPaths);

const canonicalizeSelection = (paths: Set<string>): Set<string> => {
  const normalizedList = Array.from(
    Array.from(paths)
      .map((path) => normalizePath(path))
      .filter(Boolean),
  );

  normalizedList.sort((a, b) => a.length - b.length);

  const compact = new Set<string>();
  normalizedList.forEach((path) => {
    if (hasSelectedAncestor(path, compact)) {
      return;
    }
    compact.add(path);
  });

  return compact;
};

type FolderRow = FolderNode & {
  parentPath: string;
  isExpandable: boolean;
  isExpanded: boolean;
  isLoading: boolean;
};

type FolderExplorerProps = {
  open: boolean;
  folders: FolderNode[];
  activeFolderPath: string;
  onSelectFolder: (path: string) => void;
  totalImageCount: number;
  onAddFolder?: () => void | Promise<void>;
  onRemoveFolder?: (path: string) => void | Promise<void>;
  onClearFolderDrafts?: (path: string) => void | Promise<void>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  explorerWidth: number;
  setExplorerWidth: (width: number) => void;
  loadingFolderPaths?: Set<string>;
  folderSelectionMode?: boolean;
  selectedFolderPaths?: Set<string>;
  onSetFolderSelectionMode?: (value: boolean) => void;
  onSetSelectedFolderPaths?: (paths: Set<string>) => void;
};

const FolderExplorer = ({
  open,
  folders,
  activeFolderPath,
  onSelectFolder,
  totalImageCount,
  onAddFolder,
  onRemoveFolder,
  onClearFolderDrafts,
  expandedPaths,
  onToggleExpand,
  explorerWidth,
  setExplorerWidth,
  loadingFolderPaths,
  folderSelectionMode = false,
  selectedFolderPaths = new Set<string>(),
  onSetFolderSelectionMode,
  onSetSelectedFolderPaths,
}: FolderExplorerProps) => {
  const images = useStore((state) => state.images);
  const sessionModifiedAt = useStore((state) => state.sessionModifiedAt);

  const editedFolderPaths = useMemo(() => {
    const next = new Set<string>();
    if (!Array.isArray(images) || images.length === 0) return next;
    if (!(sessionModifiedAt instanceof Map) || sessionModifiedAt.size === 0) {
      return next;
    }

    images.forEach((image) => {
      if (!sessionModifiedAt.has(image.id)) return;
      const parentPath = getDirectParentFolderPath(image.relativePath);
      if (!parentPath) return;
      next.add(parentPath);
      getAncestorPaths(parentPath).forEach((ancestorPath) => {
        next.add(ancestorPath);
      });
    });
    return next;
  }, [images, sessionModifiedAt]);

  const visibleFolders = useMemo(() => {
    const expandablePaths = new Set<string>();
    const rows = folders.map((folder) => {
      const normalizedPath = normalizePath(folder.path);
      const parentPath = normalizedPath.includes('/')
        ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
        : '';
      if (parentPath) {
        expandablePaths.add(parentPath);
      }
      return {
        ...folder,
        path: normalizedPath,
        parentPath,
      };
    });

    const rowByPath = new Map<string, (typeof rows)[number]>();
    rows.forEach((row) => {
      rowByPath.set(row.path, row);
    });

    return rows
      .map(
        (folder): FolderRow => ({
          ...folder,
          isExpandable:
            Boolean(folder.expandable) ||
            expandablePaths.has(folder.path) ||
            expandedPaths.has(folder.path),
          isExpanded: expandedPaths.has(folder.path),
          isLoading: loadingFolderPaths?.has(folder.path) || false,
        }),
      )
      .filter((folder) => {
        if (folder.depth === 0) return true;

        let ancestorPath = folder.parentPath;
        while (ancestorPath) {
          if (!expandedPaths.has(ancestorPath)) {
            return false;
          }
          ancestorPath = rowByPath.get(ancestorPath)?.parentPath || '';
        }
        return true;
      });
  }, [expandedPaths, folders, loadingFolderPaths]);

  const descendantPathMap = useMemo(() => {
    const allFolderPaths = Array.from(
      new Set(
        folders.map((folder) => normalizePath(folder.path)).filter(Boolean),
      ),
    );
    const next = new Map<string, string[]>();

    allFolderPaths.forEach((path) => {
      next.set(
        path,
        allFolderPaths.filter(
          (candidatePath) =>
            candidatePath === path || candidatePath.startsWith(`${path}/`),
        ),
      );
    });
    return next;
  }, [folders]);

  const effectiveSelectedFolderPaths = useMemo(
    () => canonicalizeSelection(selectedFolderPaths),
    [selectedFolderPaths],
  );

  useEffect(() => {
    if (!onSetSelectedFolderPaths) return;
    if (areSetsEqual(selectedFolderPaths, effectiveSelectedFolderPaths)) return;
    onSetSelectedFolderPaths(effectiveSelectedFolderPaths);
  }, [
    effectiveSelectedFolderPaths,
    onSetSelectedFolderPaths,
    selectedFolderPaths,
  ]);

  const getSelectionState = (path: string): TriState => {
    const normalizedPath = normalizePath(path);
    const descendants = descendantPathMap.get(normalizedPath) || [normalizedPath];
    const selectedCount = descendants.reduce(
      (count, candidatePath) =>
        count +
        (isPathCoveredBySelection(candidatePath, effectiveSelectedFolderPaths)
          ? 1
          : 0),
      0,
    );
    if (selectedCount <= 0) return 'unchecked';
    if (selectedCount >= descendants.length) return 'checked';
    return 'mixed';
  };

  const toggleFolderSelection = (path: string) => {
    if (!onSetSelectedFolderPaths) return;
    const normalizedPath = normalizePath(path);
    const selectionState = getSelectionState(normalizedPath);
    const next = new Set(effectiveSelectedFolderPaths);

    if (selectionState === 'checked') {
      Array.from(next).forEach((selectedPath) => {
        if (hasPathPrefix(selectedPath, normalizedPath)) {
          next.delete(selectedPath);
        }
      });
      getAncestorPaths(normalizedPath).forEach((ancestorPath) => {
        next.delete(ancestorPath);
      });
    } else {
      Array.from(next).forEach((selectedPath) => {
        if (hasPathPrefix(selectedPath, normalizedPath)) {
          next.delete(selectedPath);
        }
      });
      next.add(normalizedPath);
    }

    onSetSelectedFolderPaths(canonicalizeSelection(next));
  };

  const renderFolderRow = (folder: FolderRow) => {
    const selectionState = getSelectionState(folder.path);
    const canClearDrafts =
      Boolean(onClearFolderDrafts) && editedFolderPaths.has(folder.path);
    const canRemoveFolder = folder.depth === 0;
    const hasActionButtons =
      !folderSelectionMode && (canClearDrafts || canRemoveFolder);
    const actionClassName = hasActionButtons
      ? canClearDrafts && canRemoveFolder
        ? 'has-dual-actions'
        : 'has-single-action'
      : '';

    return (
      <div
        className={`folder-item-row ${activeFolderPath === folder.path ? 'active' : ''}`}
      >
        <button
          type="button"
          className={`folder-expansion-toggle ${
            folder.isExpandable || folder.isLoading ? 'is-visible' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (folder.isLoading) return;
            if (!folder.isExpandable && !folder.isExpanded) return;
            onToggleExpand(folder.path);
          }}
          style={{ '--folder-depth': folder.depth } as React.CSSProperties}
        >
          {folder.isLoading ? (
            <Loader2 size={14} className="folder-loading-spinner" />
          ) : folder.isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>

        <AnimatePresence initial={false}>
          {folderSelectionMode && (
            <motion.span
              className="folder-selection-check"
              style={{ '--folder-depth': folder.depth } as React.CSSProperties}
              initial={{ opacity: 0, x: -4, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -4, scale: 0.9 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
            >
              <TriStateCheckbox
                state={selectionState}
                onToggle={() => toggleFolderSelection(folder.path)}
                ariaLabel={`Select folder ${folder.name}`}
                title={`Select folder ${folder.name}`}
              />
            </motion.span>
          )}
        </AnimatePresence>

        <button
          type="button"
          role="treeitem"
          className={`folder-item ${activeFolderPath === folder.path ? 'active' : ''} ${actionClassName} ${folderSelectionMode ? 'is-select-mode' : ''}`}
          style={
            {
              '--folder-depth': folder.depth,
              '--has-chevron': folder.isExpandable || folder.isLoading ? 1 : 0,
              '--selection-offset': folderSelectionMode ? '22px' : '0px',
            } as React.CSSProperties
          }
          onClick={() => {
            if (folderSelectionMode) {
              toggleFolderSelection(folder.path);
              return;
            }
            onSelectFolder(folder.path);
          }}
          title={folder.path}
        >
          <span className="folder-item-label">
            <span className="folder-item-main-label">
              <FolderOpen size={13} />
              <span className="folder-item-name">{folder.name}</span>
            </span>
          </span>
        </button>
        {hasActionButtons && (
          <div className="folder-row-actions">
            {canClearDrafts && (
              <button
                type="button"
                className="folder-clear-drafts-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  void onClearFolderDrafts?.(folder.path);
                }}
                title={`Clear saved drafts for ${folder.name}`}
              >
                <Eraser size={12} />
              </button>
            )}
            {canRemoveFolder && (
              <button
                type="button"
                className="folder-remove-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  void onRemoveFolder?.(folder.path);
                }}
                title={`Remove folder ${folder.name}`}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const { isResizing, startResizing, liveWidth } = useSidebarResize(
    explorerWidth,
    setExplorerWidth,
    {
      side: 'left',
      minWidth: 200,
      maxWidth: (vw: number) => Math.max(400, vw * 0.4),
      defaultFallback: 260,
    },
  );

  return (
    <motion.aside
      initial={{ width: open ? liveWidth : 0 }}
      animate={{ width: open ? liveWidth : 0 }}
      transition={{ type: 'tween', duration: 0.16, ease: 'easeOut' }}
      className={`folder-explorer ${open ? 'is-open' : ''} ${isResizing ? 'resizing' : ''}`}
    >
      <div
        className="folder-explorer-shell"
        style={{ width: open ? liveWidth : 0 }}
      >
        <div className="folder-explorer-header">
          <span className="folder-explorer-header-title">
            <span>Explorer</span>
            <AnimatePresence initial={false}>
              {folderSelectionMode && (
                <motion.span
                  className="folder-selection-count"
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.14, ease: 'easeOut' }}
                >
                  {effectiveSelectedFolderPaths.size} selected
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <div className="folder-explorer-header-actions">
            <button
              type="button"
              className="folder-header-action"
              onClick={() => onAddFolder?.()}
              title="Add folder"
            >
              <FolderPlus size={13} />
            </button>
            <button
              type="button"
              className={`folder-header-action ${folderSelectionMode ? 'active' : ''}`}
              onClick={() => onSetFolderSelectionMode?.(!folderSelectionMode)}
              title={
                folderSelectionMode
                  ? 'Exit folder selection mode'
                  : 'Enable folder selection mode'
              }
            >
              <ListChecks size={13} />
            </button>
          </div>
        </div>

        <div className="folder-explorer-list" role="tree">
          <button
            type="button"
            role="treeitem"
            className={`folder-item ${activeFolderPath === ALL_FOLDERS_VALUE ? 'active' : ''} ${folderSelectionMode ? 'is-disabled' : ''}`}
            onClick={() => {
              if (folderSelectionMode) return;
              onSelectFolder(ALL_FOLDERS_VALUE);
            }}
          >
            <span className="folder-item-label">
              <ImageIcon size={13} />
              <span className="folder-item-name">All Images</span>
            </span>
          </button>

          <div className="folder-explorer-virtual-list">
            <Virtuoso
              style={{ height: '100%' }}
              totalCount={visibleFolders.length}
              overscan={240}
              itemContent={(index) => {
                const folder = visibleFolders[index];
                return folder ? renderFolderRow(folder) : null;
              }}
            />
          </div>
        </div>
      </div>

      {open && (
        <div
          className="resizer-handle"
          style={{ left: 'auto', right: -16 }}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize explorer"
          onPointerDown={startResizing}
        />
      )}
    </motion.aside>
  );
};

export default React.memo(FolderExplorer);
