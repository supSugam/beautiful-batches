import React, { useRef, useState } from 'react';
import { Upload, FolderOpen, Images } from 'lucide-react';
import './DropZone.css';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif'
]);

function isImageFile(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function DropZone({ onImagesLoaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState('');
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const processFiles = (fileList) => {
    setStatus('Scanning files...');
    // Use requestAnimationFrame to avoid blocking the UI during large scans
    requestAnimationFrame(() => {
      const images = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (isImageFile(file)) {
          images.push({
            id: `${file.webkitRelativePath || file.name}-${i}`,
            name: file.name,
            relativePath: file.webkitRelativePath || file.name,
            objectUrl: URL.createObjectURL(file),
            file,
          });
        }
      }
      setStatus('');
      if (images.length > 0) {
        onImagesLoaded(images);
      } else {
        setStatus('No image files found.');
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={`dropzone ${dragOver ? 'drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
    >
      <div className="dropzone-inner">
        <div className="dropzone-glow" />
        <div className="dropzone-icon">
          <Upload size={48} strokeWidth={1.5} />
        </div>
        <h2>Drop images or a folder here</h2>
        <p className="dropzone-sub">Supports JPG, PNG, WebP, BMP, GIF, TIFF</p>
        <div className="dropzone-divider">
          <span>or</span>
        </div>
        <div className="dropzone-actions">
          <button
            className="btn btn-primary btn-lg"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen size={18} />
            <span>Select Folder</span>
          </button>
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => fileInputRef.current?.click()}
          >
            <Images size={18} />
            <span>Select Files</span>
          </button>
        </div>
        {status && <p className="dropzone-status">{status}</p>}
      </div>

      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={(e) => processFiles(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => processFiles(e.target.files)}
      />
    </div>
  );
}
