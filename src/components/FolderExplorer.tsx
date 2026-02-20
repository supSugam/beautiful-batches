import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { FolderNode } from '../types/app';
import { useSidebarResize } from './Inspector/hooks/useSidebarResize';
import useStore from '../store/useStore';
import './FolderExplorer.css';

const ALL_FOLDERS_VALUE = '__all__';
const normalizePath = (value: unknown): string =>
  String(value || '').replace(/\\/g, '/');

const getDirectParentFolderPath = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '';
  return normalized.slice(0, lastSlash);
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
}: FolderExplorerProps) => {
  const images = useStore((state) => state.images);
  const sessionModifiedAt = useStore((state) => state.sessionModifiedAt);

  const clearableFolderPaths = useMemo(() => {
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
    });
    return next;
  }, [images, sessionModifiedAt]);

  const visibleFolders = useMemo(() => {
    const expandablePaths = new Set<string>();
    const rows = folders.map((folder) => {
      const parentPath = folder.path.includes('/')
        ? folder.path.substring(0, folder.path.lastIndexOf('/'))
        : '';
      if (parentPath) {
        expandablePaths.add(parentPath);
      }
      return {
        ...folder,
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

  const renderFolderRow = (folder: FolderRow) => {
    const canClearDrafts =
      Boolean(onClearFolderDrafts) && clearableFolderPaths.has(folder.path);
    const canRemoveFolder = folder.depth === 0;
    const hasActionButtons = canClearDrafts || canRemoveFolder;
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

        <button
          type="button"
          role="treeitem"
          className={`folder-item ${activeFolderPath === folder.path ? 'active' : ''} ${actionClassName}`}
          style={
            {
              '--folder-depth': folder.depth,
              '--has-chevron': folder.isExpandable || folder.isLoading ? 1 : 0,
            } as React.CSSProperties
          }
          onClick={() => onSelectFolder(folder.path)}
          title={folder.path}
        >
          <span className="folder-item-label">
            <span className="folder-item-main-label">
              <FolderOpen size={13} />
              <span className="folder-item-name">{folder.name}</span>
            </span>
            <span
              className={`folder-item-count-pill ${
                folder.isLoading ? 'is-loading' : ''
              } ${folder.isLoading || folder.count > 0 ? '' : 'is-hidden'}`}
            >
              {folder.isLoading ? '...' : folder.count}
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
          <span>Explorer</span>
          <div className="folder-explorer-header-actions">
            <button
              type="button"
              className="folder-header-action"
              onClick={() => onAddFolder?.()}
              title="Add folder"
            >
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        <div className="folder-explorer-list" role="tree">
          <button
            type="button"
            role="treeitem"
            className={`folder-item ${activeFolderPath === ALL_FOLDERS_VALUE ? 'active' : ''}`}
            onClick={() => onSelectFolder(ALL_FOLDERS_VALUE)}
          >
            <span className="folder-item-label">
              <ImageIcon size={13} />
              <span className="folder-item-name">All Images</span>
              <span className="folder-item-count-pill">{totalImageCount}</span>
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
