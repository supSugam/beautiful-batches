import React, { useRef, useState } from 'react';
import { Upload, FolderOpen, Images } from 'lucide-react';
import {
  ACCEPTED_IMAGE_TYPES,
  imagesFromFileList,
  loadImagesFromSavedDirectory,
  pickImagesFromDirectory,
} from '../utils/directoryPicker';
import './DropZone.css';

export function DropZone({ onImagesLoaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState('');
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const processFiles = (fileList, prefix = 'drop') => {
    setStatus('Scanning files...');
    // Use requestAnimationFrame to avoid blocking the UI during large scans
    requestAnimationFrame(() => {
      const images = imagesFromFileList(fileList, prefix);
      setStatus('');
      if (images.length > 0) {
        onImagesLoaded(images);
      } else {
        setStatus('No image files found.');
      }
    });
  };

  const handleSelectFolder = async () => {
    setStatus('Opening folder...');
    try {
      const saved = await loadImagesFromSavedDirectory({
        promptForPermission: true,
      });
      if (saved.supported && saved.available && saved.granted) {
        if (saved.images.length > 0) {
          setStatus('');
          onImagesLoaded(saved.images);
          return;
        }
      }

      const result = await pickImagesFromDirectory();
      if (!result.supported) {
        setStatus('');
        folderInputRef.current?.click();
        return;
      }
      if (result.aborted) {
        setStatus('');
        return;
      }
      if (result.images.length === 0) {
        setStatus('No image files found.');
        return;
      }
      setStatus('');
      onImagesLoaded(result.images);
    } catch (error) {
      console.error('Directory picker error:', error);
      setStatus('Could not open folder picker. Falling back...');
      requestAnimationFrame(() => folderInputRef.current?.click());
    }
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
        <p className="dropzone-sub">Supports PNG, JPG, JPEG, WebP, AVIF</p>
        <div className="dropzone-divider">
          <span>or</span>
        </div>
        <div className="dropzone-actions">
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSelectFolder}
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
        accept={ACCEPTED_IMAGE_TYPES}
        style={{ display: 'none' }}
        onChange={(e) => processFiles(e.target.files, 'folder-input')}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        style={{ display: 'none' }}
        onChange={(e) => processFiles(e.target.files, 'file-input')}
      />
    </div>
  );
}
