import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Inspector } from '../components/Inspector';
import './MainLayout.css';

const MainLayout = ({
  images,
  rowHeight,
  showAllFooters,
  selectedId,
  setSelectedId,
  handleCropChange,
  handleDelete,
  inspectorWidth,
  setInspectorWidth,
  selectNext,
  selectPrev,
  handleApplyCropToImages,
}) => {
  return (
    <div className="main-layout">
      <div className="image-grid-scroll">
        <JustifiedGrid
          images={images}
          targetRowHeight={rowHeight}
          padding={8}
          showAllFooters={showAllFooters}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCropChange={handleCropChange}
          onDelete={handleDelete}
        />
      </div>

      <AnimatePresence>
        {selectedId && (
          <Inspector
            image={images.find((img) => img.id === selectedId)}
            onCropChange={handleCropChange}
            onClose={() => setSelectedId(null)}
            onDelete={handleDelete}
            onNext={selectNext}
            onPrev={selectPrev}
            width={inspectorWidth}
            onResize={setInspectorWidth}
            onApplyTo={(type) => {
              const idx = images.findIndex((img) => img.id === selectedId);
              let targets = [];
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
