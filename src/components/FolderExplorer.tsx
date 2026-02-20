import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Loader2,
  Square,
  Trash2,
} from 'lucide-react';
import type { FolderNode } from '../types/app';
import { useSidebarResize } from './Inspector/hooks/useSidebarResize';
import './FolderExplorer.css';

const ALL_FOLDERS_VALUE = '__all__';

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
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  recursiveScan: boolean;
  setRecursiveScan: (recursive: boolean) => void;
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
  expandedPaths,
  onToggleExpand,
  recursiveScan,
  setRecursiveScan,
  explorerWidth,
  setExplorerWidth,
  loadingFolderPaths,
}: FolderExplorerProps) => {
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

  const renderFolderRow = (folder: FolderRow) => (
    <div
      className={`folder-item-row ${activeFolderPath === folder.path ? 'active' : ''} ${
        folder.depth === 0 ? 'has-remove' : ''
      }`}
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
        className={`folder-item ${activeFolderPath === folder.path ? 'active' : ''} ${
          folder.depth === 0 ? 'is-removable' : ''
        }`}
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
          <FolderOpen size={13} />
          <span className="folder-item-name">{folder.name}</span>
          <span
            className={`folder-item-count-pill ${folder.isLoading ? 'is-loading' : ''}`}
          >
            {folder.isLoading ? '...' : folder.count}
          </span>
        </span>
      </button>
      {folder.depth === 0 && (
        <button
          type="button"
          className="folder-remove-btn"
          onClick={() => onRemoveFolder?.(folder.path)}
          title={`Remove folder ${folder.name}`}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );

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
              className={`folder-header-action ${recursiveScan ? 'active' : ''}`}
              onClick={() => setRecursiveScan(!recursiveScan)}
              title={
                recursiveScan
                  ? 'Recursive Scan: Enabled'
                  : 'Recursive Scan: Disabled (Direct Only)'
              }
            >
              {recursiveScan ? <Layers size={13} /> : <Square size={13} />}
            </button>
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
