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
    const zip = new JSZip();
    const formatMime = format === 'jpg' ? 'image/jpeg'
                     : format === 'webp' ? 'image/webp'
                     : 'image/png';
    const ext = format === 'jpg' ? '.jpg' : format === 'webp' ? '.webp' : '.png';

    for (let i = 0; i < images.length; i++) {
      try {
        const img = images[i];
        const bitmap = await createImageBitmap(img.file);

        // Retrieve crop data and transforms
        const cropEntry = cropData.get(img.id);
        // Normalize data structure (handle legacy/simple coords vs object with transforms)
        const coordinates =
          cropEntry?.coordinates || (cropEntry?.width ? cropEntry : null);
        const transforms = cropEntry?.transforms || {
          rotate: 0,
          flip: { horizontal: false, vertical: false },
        };

        const hasTransforms =
          transforms.rotate !== 0 ||
          transforms.flip.horizontal ||
          transforms.flip.vertical;

        // Determine effective source dimensions (swapped if rotated 90/270)
        // If transformed, we reference the transformed dimensions.
        // If not transformed, we reference original bitmap.
        const isRotated90 = Math.abs(transforms.rotate) % 180 === 90;
        const sourceWidth =
          hasTransforms && isRotated90 ? bitmap.height : bitmap.width;
        const sourceHeight =
          hasTransforms && isRotated90 ? bitmap.width : bitmap.height;

        // Determine crop region (default to full source if no crop)
        const sx = coordinates ? Math.round(coordinates.left) : 0;
        const sy = coordinates ? Math.round(coordinates.top) : 0;
        const sw = coordinates ? Math.round(coordinates.width) : sourceWidth;
        const sh = coordinates ? Math.round(coordinates.height) : sourceHeight;

        // Create final canvas
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (hasTransforms) {
          // 1. Create intermediate canvas for the full transformed image
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = sourceWidth;
          tempCanvas.height = sourceHeight;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.imageSmoothingEnabled = true;
          tempCtx.imageSmoothingQuality = 'high';

          // 2. Apply transforms to temp context
          tempCtx.save();
          tempCtx.translate(sourceWidth / 2, sourceHeight / 2);
          tempCtx.rotate((transforms.rotate * Math.PI) / 180);
          tempCtx.scale(
            transforms.flip.horizontal ? -1 : 1,
            transforms.flip.vertical ? -1 : 1,
          );
          // Draw original bitmap centered
          tempCtx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          tempCtx.restore();

          // 3. Crop from temp canvas
          ctx.drawImage(tempCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        } else {
          // Direct crop from bitmap (Optimization)
          ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        }

        bitmap.close();

        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, formatMime, quality / 100),
        );

        const baseName = img.name.replace(/\.[^.]+$/, '');
        zip.file(`${baseName}${ext}`, blob);
      } catch (err) {
        console.error(`Failed: ${images[i].name}`, err);
      }
      setProcessing({ current: i + 1, total: images.length });
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cropped_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setProcessing(null);
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
