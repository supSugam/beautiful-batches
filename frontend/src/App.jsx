import React, { useState, useCallback, useMemo, useRef } from 'react';
import { DropZone } from './components/DropZone';
import { JustifiedGrid } from './components/JustifiedGrid';
import { Inspector } from './components/Inspector';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  Download,
  XCircle,
  Loader2,
  Grid3x3,
  Maximize,
  FolderPlus,
  Image as ImageIcon,
  Settings,
} from 'lucide-react';
import './App.css';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif'
]);

// Load natural dimensions for each image file
function loadImageWithDimensions(file, id, relativePath) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        id,
        name: file.name,
        relativePath,
        objectUrl,
        file,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        naturalRatio: img.naturalWidth / img.naturalHeight,
      });
    };
    img.onerror = () => {
      resolve({
        id,
        name: file.name,
        relativePath,
        objectUrl,
        file,
        naturalWidth: 1,
        naturalHeight: 1,
        naturalRatio: 1,
      });
    };
    img.src = objectUrl;
  });
}

function App() {
  const [images, setImages] = useState([]);
  const [cropData, setCropData] = useState(new Map());
  const [processing, setProcessing] = useState(null);
  const [rowHeight, setRowHeight] = useState(250); // Default target row height
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(90);
  const [showAllFooters, setShowAllFooters] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const addMoreRef = useRef(null);

  const handleImagesLoaded = useCallback(async (rawImages) => {
    const withDims = await Promise.all(
      rawImages.map((img) =>
        loadImageWithDimensions(img.file, img.id, img.relativePath),
      ),
    );
    setImages((prev) => [...prev, ...withDims]);
  }, []);

  const handleCropChange = useCallback((id, coords) => {
    setCropData(prev => {
      const next = new Map(prev);
      next.set(id, coords);
      return next;
    });
  }, []);

  const handleApplyCropToImages = useCallback((sourceId, targetIds) => {
    const sourceData = cropData.get(sourceId);
    if (!sourceData) return;

    const sourceImg = images.find(img => img.id === sourceId);
    if (!sourceImg) return;

    const transforms = sourceData.transforms || { rotate: 0, flip: { horizontal: false, vertical: false } };
    const { rotate } = transforms;
    const isRotated90 = rotate % 180 === 90;
    const sourceW = isRotated90 ? sourceImg.naturalHeight : sourceImg.naturalWidth;
    const sourceH = isRotated90 ? sourceImg.naturalWidth : sourceImg.naturalHeight;

    const relLeft = sourceData.coordinates.left / sourceW;
    const relTop = sourceData.coordinates.top / sourceH;
    const relWidth = sourceData.coordinates.width / sourceW;
    const relHeight = sourceData.coordinates.height / sourceH;

    setCropData(prev => {
      const next = new Map(prev);
      targetIds.forEach(id => {
        const targetImg = images.find(img => img.id === id);
        if (!targetImg) return;

        const targetW = isRotated90 ? targetImg.naturalHeight : targetImg.naturalWidth;
        const targetH = isRotated90 ? targetImg.naturalWidth : targetImg.naturalHeight;

        next.set(id, {
          ...sourceData,
          coordinates: {
            left: Math.round(relLeft * targetW),
            top: Math.round(relTop * targetH),
            width: Math.round(relWidth * targetW),
            height: Math.round(relHeight * targetH),
          }
        });
      });
      return next;
    });
  }, [cropData, images]);

  const selectNext = useCallback(() => {
    setSelectedId(prev => {
      if (!prev) return null;
      const idx = images.findIndex(img => img.id === prev);
      if (idx < images.length - 1) return images[idx + 1].id;
      return prev;
    });
  }, [images]);

  const selectPrev = useCallback(() => {
    setSelectedId(prev => {
      if (!prev) return null;
      const idx = images.findIndex(img => img.id === prev);
      if (idx > 0) return images[idx - 1].id;
      return prev;
    });
  }, [images]);

  const handleDelete = useCallback((id) => {
    setImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);
      return prev.filter(i => i.id !== id);
    });
    setCropData(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    images.forEach(img => {
      if (img.objectUrl) URL.revokeObjectURL(img.objectUrl);
    });
    setImages([]);
    setCropData(new Map());
  }, [images]);

  const handleExport = useCallback(async () => {
    if (images.length === 0) return;

    setProcessing({ current: 0, total: images.length });
    
    try {
      const formData = new FormData();
      const cropsMap = {};

      for (const img of images) {
        const cropEntry = cropData.get(img.id);
        // Map crop data using the original filename as key (or rename file)
        // Let's rename the file to something unique and track it
        const uniqueName = `${img.id}_${img.name}`;
        formData.append('files', img.file, uniqueName);
        
        cropsMap[uniqueName] = {
          coordinates: cropEntry?.coordinates || null,
          transforms: cropEntry?.transforms || {
            rotate: 0,
            flip: { horizontal: false, vertical: false },
          },
          outputWidth: cropEntry?.outputWidth || null,
        };
      }

      formData.append('config', JSON.stringify({
        format,
        quality,
        crops: cropsMap
      }));

      const response = await fetch('http://localhost:8000/api/process-bulk', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cropped_images_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export images: ' + err.message);
    } finally {
      setProcessing(null);
    }
  }, [images, cropData, format, quality]);

  const handleAddMore = useCallback(async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const valid = Array.from(files).filter((f) =>
      IMAGE_EXTENSIONS.has('.' + f.name.split('.').pop().toLowerCase()),
    );
    const withDims = await Promise.all(
      valid.map((file, i) =>
        loadImageWithDimensions(
          file,
          `add-${Date.now()}-${i}`,
          file.webkitRelativePath || file.name,
        ),
      ),
    );
    if (withDims.length > 0) setImages((prev) => [...prev, ...withDims]);
    e.target.value = '';
  }, []);

  const folderName = useMemo(() => {
    if (images.length === 0) return '';
    const first = images[0]?.relativePath || '';
    const parts = first.split('/');
    return parts.length > 1 ? parts[0] : 'Selected Files';
  }, [images]);

  const hasImages = images.length > 0;

  if (!hasImages) {
    return (
      <div className="app">
        <DropZone onImagesLoaded={handleImagesLoaded} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-section">
          <FolderOpen size={15} className="toolbar-dim" />
          <span className="toolbar-title">{folderName}</span>
          <span className="toolbar-badge-muted">
            <ImageIcon size={11} />
            {images.length.toLocaleString()}
          </span>
        </div>

        <div className="toolbar-section toolbar-controls">
          <div className="control-group">
            <label className="control-label">Format</label>
            <select
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="png">PNG</option>
              <option value="jpg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>

          {format !== 'png' && (
            <div className="control-group">
              <label className="control-label">Quality</label>
              <input
                type="range"
                className="quality-slider"
                min={10}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
              <span className="quality-value">{quality}%</span>
            </div>
          )}

          <div className="control-group">
            <Grid3x3 size={13} className="toolbar-dim" />
            <input
              type="range"
              className="size-slider"
              min={150}
              max={500}
              value={rowHeight}
              onChange={(e) => setRowHeight(Number(e.target.value))}
            />
            <Maximize size={14} className="toolbar-dim" />
          </div>

          <div className="toolbar-divider" />

          <button
            className={`btn btn-sm ${showAllFooters ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setShowAllFooters(!showAllFooters)}
            title={showAllFooters ? 'Hide Settings' : 'Show Settings'}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>

        <div className="toolbar-section toolbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => addMoreRef.current?.click()}
          >
            <FolderPlus size={14} />
            <span>Add</span>
          </button>
          <button
            className="btn btn-ghost btn-danger-ghost btn-sm"
            onClick={clearAll}
          >
            <XCircle size={14} />
            <span>Clear</span>
          </button>

          <div className="toolbar-divider" />

          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={!!processing}
          >
            {processing ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>
                  {processing.current}/{processing.total}
                </span>
              </>
            ) : (
              <>
                <Download size={14} />
                <span>Export All</span>
              </>
            )}
          </button>
        </div>
      </header>

      {processing && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${(processing.current / processing.total) * 100}%`,
            }}
          />
        </div>
      )}

      {/* Main Layout: Grid + Sidebar */}
      <div className="main-layout">
        <div className="image-grid-scroll">
          <JustifiedGrid
            images={images}
            targetRowHeight={rowHeight} // Slider controls target height
            padding={8}
            cropData={cropData}
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
              cropState={cropData.get(selectedId)}
              onCropChange={handleCropChange}
              onClose={() => setSelectedId(null)}
              onDelete={handleDelete}
              onNext={selectNext}
              onPrev={selectPrev}
              onApplyTo={(type) => {
                const idx = images.findIndex(img => img.id === selectedId);
                let targets = [];
                if (type === 'all') {
                  targets = images.filter(img => img.id !== selectedId).map(img => img.id);
                } else if (type === 'rest') {
                  targets = images.slice(idx + 1).map(img => img.id);
                } else if (type === 'prev') {
                  targets = images.slice(0, idx).map(img => img.id);
                }
                handleApplyCropToImages(selectedId, targets);
              }}
              hasNext={images.findIndex(img => img.id === selectedId) < images.length - 1}
              hasPrev={images.findIndex(img => img.id === selectedId) > 0}
            />
          )}
        </AnimatePresence>
      </div>

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
