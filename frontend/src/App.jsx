import React, { useMemo, useRef } from 'react';
import { DropZone } from './components/DropZone';
import Toolbar from './components/Toolbar/Toolbar';
import ProgressBar from './components/common/ProgressBar';
import MainLayout from './layouts/MainLayout';
import useStore from './store/useStore';
import { useImageUpload } from './hooks/useImageUpload';
import { useExportLogic } from './hooks/useExportLogic';
import './App.css';

function App() {
  const images = useStore((state) => state.images);
  const rowHeight = useStore((state) => state.rowHeight);
  const format = useStore((state) => state.format);
  const quality = useStore((state) => state.quality);
  const showAllFooters = useStore((state) => state.showAllFooters);
  const selectedId = useStore((state) => state.selectedId);
  const inspectorWidth = useStore((state) => state.inspectorWidth);
  const setSelectedId = useStore((state) => state.setSelectedId);
  const selectNext = useStore((state) => state.selectNext);
  const selectPrev = useStore((state) => state.selectPrev);
  const setCropChange = useStore((state) => state.setCropChange);
  const applyCropToImages = useStore((state) => state.applyCropToImages);
  const setRowHeight = useStore((state) => state.setRowHeight);
  const setFormat = useStore((state) => state.setFormat);
  const setQuality = useStore((state) => state.setQuality);
  const setShowAllFooters = useStore((state) => state.setShowAllFooters);
  const setInspectorWidth = useStore((state) => state.setInspectorWidth);
  const clearAll = useStore((state) => state.clearAll);
  const processing = useStore((state) => state.processing);

  const addMoreRef = useRef(null);
  const { handleImagesLoaded, handleAddMore } = useImageUpload();
  const { handleExport } = useExportLogic();

  const folderName = useMemo(() => {
    if (images.length === 0) return '';
    const first = images[0]?.relativePath || '';
    const parts = first.split('/');
    return parts.length > 1 ? parts[0] : 'Selected Files';
  }, [images]);

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
        imageCount={images.length}
        format={format}
        setFormat={setFormat}
        quality={quality}
        setQuality={setQuality}
        rowHeight={rowHeight}
        setRowHeight={setRowHeight}
        showAllFooters={showAllFooters}
        setShowAllFooters={setShowAllFooters}
        onAddMore={() => addMoreRef.current?.click()}
        onClearAll={clearAll}
        onExport={handleExport}
        processing={processing}
      />

      <ProgressBar current={processing?.current} total={processing?.total} />

      <MainLayout
        images={images}
        rowHeight={rowHeight}
        showAllFooters={showAllFooters}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        handleCropChange={setCropChange}
        handleDelete={(id) => useStore.getState().deleteImage(id)}
        inspectorWidth={inspectorWidth}
        setInspectorWidth={setInspectorWidth}
        selectNext={selectNext}
        selectPrev={selectPrev}
        handleApplyCropToImages={applyCropToImages}
      />

      <input
        ref={addMoreRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleAddMore}
      />
    </div>
  );
}

export default App;
