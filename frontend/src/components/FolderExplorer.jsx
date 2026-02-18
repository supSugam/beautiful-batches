import React from 'react';
import { FolderOpen, FolderPlus, Image as ImageIcon, Trash2 } from 'lucide-react';
import './FolderExplorer.css';

const ALL_FOLDERS_VALUE = '__all__';

const FolderExplorer = ({
  open,
  folders,
  activeFolderPath,
  onSelectFolder,
  totalImageCount,
  onAddFolder,
  onRemoveFolder,
}) => {
  return (
    <aside className={`folder-explorer ${open ? 'is-open' : ''}`}>
      <div className="folder-explorer-shell">
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

          {folders.map((folder) => (
            <div
              key={folder.path}
              className={`folder-item-row ${activeFolderPath === folder.path ? 'active' : ''} ${
                folder.depth === 0 ? 'has-remove' : ''
              }`}
            >
              <button
                type="button"
                role="treeitem"
                className={`folder-item ${activeFolderPath === folder.path ? 'active' : ''} ${
                  folder.depth === 0 ? 'is-removable' : ''
                }`}
                style={{ '--folder-depth': folder.depth }}
                onClick={() => onSelectFolder(folder.path)}
                title={folder.path}
              >
                <span className="folder-item-label">
                  <FolderOpen size={13} />
                  <span className="folder-item-name">{folder.name}</span>
                  <span className="folder-item-count-pill">{folder.count}</span>
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
          ))}
        </div>
      </div>
    </aside>
  );
};

export default React.memo(FolderExplorer);
