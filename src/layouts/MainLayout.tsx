import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Inspector } from '../components/Inspector';
import FolderExplorer from '../components/FolderExplorer';
import type { CropEntry, FolderNode, GalleryImage } from '../types/app';
import './MainLayout.css';

type ApplyTargetType = 'all' | 'rest' | 'prev';
type ApplyOptions = { includeCaption?: boolean };

type MainLayoutProps = {
  images: GalleryImage[];
  rowHeight: number;
  showAllFooters: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  handleCropChange: (id: string, coords: CropEntry) => void;
  handleDelete: (id: string) => void;
  onLoadMoreImages?: () => void;
  inspectorWidth: number;
  setInspectorWidth: (width: number) => void;
  explorerWidth: number;
  setExplorerWidth: (width: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  handleApplyCropToImages: (
    sourceId: string,
    targetIds: string[],
    options?: ApplyOptions,
  ) => void;
  explorerOpen: boolean;
  folderNodes: FolderNode[];
  activeFolderPath: string;
  onSelectFolder: (path: string) => void;
  totalImageCount: number;
  onResetFolderFilter: () => void;
  onAddFolder: () => void | Promise<void>;
  onRemoveFolder: (path: string) => void | Promise<void>;
  onClearFolderDrafts: (path: string) => void | Promise<void>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  loadingFolderPaths?: Set<string>;
  isActiveFolderLoading?: boolean;
  folderSelectionMode?: boolean;
  selectedFolderPaths?: Set<string>;
  onSetFolderSelectionMode?: (value: boolean) => void;
  onSetSelectedFolderPaths?: (paths: Set<string>) => void;
};

const MainLayout = ({
  images,
  rowHeight,
  selectedId,
  setSelectedId,
  handleCropChange,
  handleDelete,
  onLoadMoreImages,
  inspectorWidth,
  setInspectorWidth,
  explorerWidth,
  setExplorerWidth,
  selectNext,
  selectPrev,
  handleApplyCropToImages,
  explorerOpen,
  folderNodes,
  activeFolderPath,
  onSelectFolder,
  totalImageCount,
  onResetFolderFilter,
  onAddFolder,
  onRemoveFolder,
  onClearFolderDrafts,
  expandedPaths,
  onToggleExpand,
  loadingFolderPaths,
  isActiveFolderLoading,
  folderSelectionMode = false,
  selectedFolderPaths = new Set<string>(),
  onSetFolderSelectionMode,
  onSetSelectedFolderPaths,
}: MainLayoutProps) => {
  const selectedImage = images.find((img) => img.id === selectedId);

  return (
    <div className="main-layout">
      <FolderExplorer
        open={explorerOpen}
        folders={folderNodes}
        activeFolderPath={activeFolderPath}
        onSelectFolder={onSelectFolder}
        totalImageCount={totalImageCount}
        onAddFolder={onAddFolder}
        onRemoveFolder={onRemoveFolder}
        onClearFolderDrafts={onClearFolderDrafts}
        expandedPaths={expandedPaths}
        onToggleExpand={onToggleExpand}
        explorerWidth={explorerWidth}
        setExplorerWidth={setExplorerWidth}
        loadingFolderPaths={loadingFolderPaths}
        folderSelectionMode={folderSelectionMode}
        selectedFolderPaths={selectedFolderPaths}
        onSetFolderSelectionMode={onSetFolderSelectionMode}
        onSetSelectedFolderPaths={onSetSelectedFolderPaths}
      />

      <div className="image-grid-scroll">
        {images.length > 0 ? (
          <JustifiedGrid
            images={images}
            targetRowHeight={rowHeight}
            padding={8}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={handleDelete}
            onEndReached={onLoadMoreImages}
          />
        ) : isActiveFolderLoading ? (
          <div className="grid-empty-state">
            <p>Scanning folder...</p>
          </div>
        ) : (
          <div className="grid-empty-state">
            <p>No images in this folder selection.</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onResetFolderFilter}
            >
              Show All Images
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedId && selectedImage && (
          <Inspector
            image={selectedImage}
            onCropChange={handleCropChange}
            onClose={() => setSelectedId(null)}
            onDelete={handleDelete}
            onNext={selectNext}
            onPrev={selectPrev}
            width={inspectorWidth}
            onResize={setInspectorWidth}
            onApplyTo={(type: ApplyTargetType, options?: ApplyOptions) => {
              const idx = images.findIndex((img) => img.id === selectedId);
              if (idx < 0) return;
              let targets: string[] = [];
              if (type === 'all') {
                targets = images
                  .filter((img) => img.id !== selectedId)
                  .map((img) => img.id);
              } else if (type === 'rest') {
                targets = images.slice(idx + 1).map((img) => img.id);
              } else if (type === 'prev') {
                targets = images.slice(0, idx).map((img) => img.id);
              }
              handleApplyCropToImages(selectedId, targets, options);
            }}
            hasNext={
              images.findIndex((img) => img.id === selectedId) <
              images.length - 1
            }
            hasPrev={images.findIndex((img) => img.id === selectedId) > 0}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainLayout;
