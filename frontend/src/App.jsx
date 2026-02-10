import React, { useState, useCallback, useMemo, useRef } from 'react';
import { DropZone } from './components/DropZone';
import { ImageCard } from './components/ImageCard';
import JSZip from 'jszip';
import {
  FolderOpen, Download, XCircle, Loader2,
  Grid3x3, Maximize, FolderPlus, Image as ImageIcon
} from 'lucide-react';
import './App.css';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif'
]);

function App() {
  const [images, setImages] = useState([]);
  const [cropData, setCropData] = useState(new Map()); // id → { left, top, width, height }
  const [processing, setProcessing] = useState(null);
  const [columnWidth, setColumnWidth] = useState(280);

  // Export settings only
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(90);

  const addMoreRef = useRef(null);

  const handleImagesLoaded = useCallback((newImages) => {
    setImages(prev => [...prev, ...newImages]);
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

  // Export: crop region = output size (no resize)
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
        const crop = cropData.get(img.id);

        // Crop coordinates from the cropper, or full image if not cropped
        let sx, sy, sw, sh;
        if (crop) {
          sx = Math.round(crop.left);
          sy = Math.round(crop.top);
          sw = Math.round(crop.width);
          sh = Math.round(crop.height);
        } else {
          // No crop = full image
          sx = 0;
          sy = 0;
          sw = bitmap.width;
          sh = bitmap.height;
        }

        // Output size = crop size (no resizing)
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        bitmap.close();

        const blob = await new Promise(resolve =>
          canvas.toBlob(resolve, formatMime, quality / 100)
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

  const handleAddMore = useCallback((e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newImages = Array.from(files)
      .filter(f => IMAGE_EXTENSIONS.has('.' + f.name.split('.').pop().toLowerCase()))
      .map((file, i) => ({
        id: `add-${Date.now()}-${i}`,
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        objectUrl: URL.createObjectURL(file),
        file,
      }));
    if (newImages.length > 0) setImages(prev => [...prev, ...newImages]);
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
          {/* Format */}
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

          {/* Quality (only for lossy formats) */}
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

          {/* Grid Size */}
          <div className="control-group">
            <Grid3x3 size={13} className="toolbar-dim" />
            <input
              type="range"
              className="size-slider"
              min={200}
              max={500}
              value={columnWidth}
              onChange={(e) => setColumnWidth(Number(e.target.value))}
            />
            <Maximize size={14} className="toolbar-dim" />
          </div>
        </div>

        <div className="toolbar-section toolbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => addMoreRef.current?.click()}
          >
            <FolderPlus size={14} />
            <span>Add</span>
          </button>
          <button className="btn btn-ghost btn-danger-ghost btn-sm" onClick={clearAll}>
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
                <span>{processing.current}/{processing.total}</span>
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

      {/* Progress Bar */}
      {processing && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(processing.current / processing.total) * 100}%` }}
          />
        </div>
      )}

      {/* Image Grid */}
      <div className="image-grid-scroll">
        <div
          className="image-grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))`
          }}
        >
          {images.map(img => (
            <ImageCard
              key={img.id}
              image={img}
              cropState={cropData.get(img.id)}
              onCropChange={handleCropChange}
              onDelete={handleDelete}
              globalAspect={null}
            />
          ))}
        </div>
      </div>

      {/* Hidden file input */}
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
