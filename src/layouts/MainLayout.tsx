import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Inspector } from '../components/Inspector';
import FolderExplorer from '../components/FolderExplorer';
import type { CropEntry, FolderNode, GalleryImage } from '../types/app';
import './MainLayout.css';

type ApplyTargetType = 'all' | 'rest' | 'prev';

type MainLayoutProps = {
  images: GalleryImage[];
  rowHeight: number;
  showAllFooters: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  handleCropChange: (id: string, coords: CropEntry) => void;
  handleDelete: (id: string) => void;
  inspectorWidth: number;
  setInspectorWidth: (width: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  handleApplyCropToImages: (sourceId: string, targetIds: string[]) => void;
  explorerOpen: boolean;
  folderNodes: FolderNode[];
  activeFolderPath: string;
  onSelectFolder: (path: string) => void;
  totalImageCount: number;
  onResetFolderFilter: () => void;
  onAddFolder: () => void | Promise<void>;
  onRemoveFolder: (path: string) => void | Promise<void>;
};

const MainLayout = ({
  images,
  rowHeight,
  selectedId,
  setSelectedId,
  handleCropChange,
  handleDelete,
  inspectorWidth,
  setInspectorWidth,
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
          />
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
            key={selectedImage.id}
            image={selectedImage}
            onCropChange={handleCropChange}
            onClose={() => setSelectedId(null)}
            onDelete={handleDelete}
            onNext={selectNext}
            onPrev={selectPrev}
            width={inspectorWidth}
            onResize={setInspectorWidth}
            onApplyTo={(type: ApplyTargetType) => {
              const idx = images.findIndex((img) => img.id === selectedId);
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
              handleApplyCropToImages(selectedId, targets);
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
